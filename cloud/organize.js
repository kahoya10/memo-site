import {editorLink, openNotebook, pngUrl, supabaseClient, value, writeStatus} from "./api.js";

const status = document.getElementById("cloudStatus");

async function start() {
  const client = supabaseClient();
  const args = new URLSearchParams(location.search);
  const opened = await openNotebook(client, args.get("book"));
  if (!opened) return;
  const {book} = opened;
  const app = document.getElementById("organizeApp");
  const kind = app.dataset.kind;
  const link = (mode, id) => `./${mode === "map" ? "map" : "organize"}.html?book=${book.id}${id ? `&view=${id}` : ""}`;
  const pages = book.sapgu_chapters.flatMap(chapter => chapter.sapgu_pages.map(page => ({
    id: page.id, title: page.title, chapter: chapter.title, ink: page.ink_data, paper: page.paper_template,
    paper_url: page.paper_template === "custom" ? pngUrl(page.paper_image) : "",
    paragraphs: [(page.recognized_text || page.text_content), ...page.text_boxes.map(item => item.text),
      ...page.sticky_notes.map(item => item.text)].flatMap(text => String(text ?? "").split("\n")).map(text => text.trim()).filter(Boolean),
  })));
  const views = await value(client.from("sapgu_views").select("*").eq("notebook_id", book.id).eq("kind", kind)
    .order("updated_at", {ascending: false}));
  const selected = views.find(item => item.id === args.get("view"));
  app.dataset.view = selected?.id ?? "";
  app.querySelector(".back-link").href = "./index.html";
  app.querySelector(".page-heading > a").href = editorLink(book.id);
  app.querySelector("h1").textContent = `${book.title} 정리`;
  app.querySelector('[href="?mode=reorder"]').href = link("reorder");
  app.querySelector('[href="?mode=map"]').href = link("map");
  if (kind === "map") document.getElementById("mapRoot").textContent = book.title;
  document.getElementById("organizeEmpty").textContent = book.title;
  const select = document.getElementById("savedViews");
  select.replaceChildren(new Option("새로 만들기", link(kind)));
  for (const view of views) select.add(new Option(view.name, link(kind, view.id), false, view.id === selected?.id));
  document.getElementById("sourceUnit").value = selected?.unit ?? "page";
  document.getElementById("viewName").value = selected?.name ?? "";
  document.getElementById("organize-source").textContent = JSON.stringify(pages);
  document.getElementById("organize-items").textContent = JSON.stringify(selected?.items ?? []);

  window.sapguSaveView = async payload => {
    const source = new Set(pages.map(page => page.id));
    const changes = {name: payload.name.trim(), kind, unit: payload.unit, notebook_id: book.id,
      items: payload.items.filter(item => source.has(item.page)).slice(0, 100), updated_at: new Date().toISOString()};
    const table = client.from("sapgu_views");
    const query = selected ? table.update(changes).eq("id", selected.id) : table.insert(changes);
    const saved = await value(query.select("id").single());
    return {url: link(kind, saved.id)};
  };
  document.querySelector(".site-main").hidden = false;
  await import("../notes-site/static/notes/organize.js");
  status.hidden = true;
}

start().catch(error => writeStatus(status, error.message || "정리 화면을 열지 못했어요.", true));
