import {editorLink, openNotebook, pngUrl, readPng, supabaseClient, value, writeStatus} from "./api.js";

const status = document.getElementById("cloudStatus");
const app = document.getElementById("editorApp");
const params = new URLSearchParams(location.search);
const bookId = params.get("book");

function json(id, data) {
  document.getElementById(id).textContent = JSON.stringify(data);
}

function paperStyle(element, page) {
  for (const name of [...element.classList]) {
    if (name.startsWith("paper-") && name !== "paper-thumbnail") element.classList.remove(name);
  }
  element.classList.add(`paper-${page.paper_template}`);
  const image = pngUrl(page.paper_image);
  element.style.setProperty("--paper-image", image ? `url(${image})` : "none");
}

function renameFields(parent, id, title) {
  const form = parent.querySelector("[data-title-edit-form]");
  const button = parent.querySelector("[data-title-edit-target]");
  form.id = id;
  form.elements.title.defaultValue = title;
  button.dataset.titleEditTarget = id;
  button.textContent = title;
  return form;
}

async function start() {
  const client = supabaseClient();
  const opened = await openNotebook(client, bookId);
  if (!opened) return;
  const {book, user} = opened;
  const chapters = book.sapgu_chapters;
  const pages = chapters.flatMap(chapter => chapter.sapgu_pages);
  const page = pages.find(item => item.id === params.get("page")) || pages[0];
  if (!page) { location.replace(`./index.html?empty=${bookId}`); return; }
  const [preferences] = await value(client.from("sapgu_preferences").select("settings").limit(1));
  const pageIndex = pages.indexOf(page);
  function navigate(pageId) { location.href = editorLink(book.id, pageId); }

  const transport = {
    async savePreferences(settings) {
      await value(client.from("sapgu_preferences").upsert({owner_id: user.id, settings}));
    },
    async savePage(payload) {
      const updatedAt = new Date().toISOString();
      const changes = {
        title: payload.title.trim() || page.title,
        ink_data: payload.ink_data,
        text_boxes: payload.text_boxes,
        sticky_notes: payload.sticky_notes,
        paper_template: payload.paper_template,
        updated_at: updatedAt,
      };
      if (payload.recognition_reviewed) {
        changes.recognized_text = payload.recognized_text.slice(0, 50000);
        changes.quiz_terms = payload.quiz_terms.slice(0, 50).map(word => word.slice(0, 100));
        const lines = changes.recognized_text.split("\n");
        changes.recognition_blocks = lines.length === page.recognition_blocks.length
          ? page.recognition_blocks.map((block, index) => ({...block, text: lines[index]})) : [];
        changes.uncertain_ranges = [];
      }
      const saved = await value(client.from("sapgu_pages").update(changes).eq("id", page.id)
        .select("recognized_text,quiz_terms,recognition_blocks,updated_at").single());
      Object.assign(page, changes);
      return {...saved, blocks: saved.recognition_blocks};
    },
  };
  window.sapguEditorTransport = transport;

  function bind(form, action, {flush = true, question} = {}) {
    form.removeAttribute("action");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (question && !confirm(question)) return;
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        if (flush && transport.flushPage && !await transport.flushPage()) throw new Error("현재 페이지 저장에 실패했어요.");
        await action(new FormData(form));
      } catch (error) {
        writeStatus(document.getElementById("saveStatus"), error.message || "변경 사항을 저장하지 못했어요.", true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  const list = app.querySelector(".chapter-list");
  const sampleChapter = list.firstElementChild;
  const samplePage = sampleChapter.querySelector(".page-link");
  const sampleDelete = sampleChapter.querySelector(".page-delete-form");
  const head = app.querySelector(".drawer-head");
  head.querySelector(".back-link").href = "./index.html";
  head.querySelector(".back-link").addEventListener("click", async event => {
    event.preventDefault();
    if (await transport.flushPage?.()) location.href = "./index.html";
  });
  head.querySelector("small").textContent = book.subject;
  bind(renameFields(head, "notebook-title-form", book.title), async fields => {
    const title = fields.get("title").trim();
    await value(client.from("sapgu_notebooks").update({title}).eq("id", book.id).select("id").single());
    navigate(page.id);
  });

  list.replaceChildren(...chapters.map(chapter => {
    const group = sampleChapter.cloneNode(true);
    group.dataset.chapterId = chapter.id;
    const toggle = group.querySelector(".chapter-toggle");
    const holder = group.querySelector(".chapter-pages");
    const actions = holder.querySelector(".chapter-actions");
    holder.id = `chapter-pages-${chapter.id}`;
    toggle.setAttribute("aria-controls", holder.id);
    toggle.setAttribute("aria-label", `${chapter.title} 페이지 목록 펼치기`);
    bind(renameFields(group, `chapter-title-form-${chapter.id}`, chapter.title), async fields => {
      const title = fields.get("title").trim();
      await value(client.from("sapgu_chapters").update({title}).eq("id", chapter.id).select("id").single());
      navigate(page.id);
    });
    const links = chapter.sapgu_pages.flatMap(item => {
      const link = samplePage.cloneNode(true);
      link.href = editorLink(book.id, item.id);
      link.classList.toggle("active", item.id === page.id);
      link.setAttribute("aria-label", item.title);
      link.title = item.title;
      link.querySelector(".sr-only").textContent = item.title;
      const thumbnail = link.querySelector("canvas");
      thumbnail.dataset.pagePreviewId = item.id;
      paperStyle(thumbnail, item);
      if (item.id !== page.id) return [link];
      const remove = sampleDelete.cloneNode(true);
      bind(remove, async () => {
        await value(client.from("sapgu_pages").delete().eq("id", item.id).select("id").single());
        navigate(pages[pageIndex + 1]?.id ?? pages[pageIndex - 1]?.id);
      }, {flush: false, question: "이 페이지를 삭제할까요?"});
      return [link, remove];
    });
    holder.replaceChildren(...links, actions);
    const addPage = actions.querySelector("[data-add-page]");
    addPage.removeAttribute("data-add-page");
    bind(addPage, async () => {
      navigate(await value(client.rpc("sapgu_new_page", {parent_chapter: chapter.id})));
    });
    bind(actions.querySelector(".inline-chapter-add form"), async fields => {
      const id = await value(client.rpc("sapgu_new_chapter", {
        book: book.id, chapter_title: fields.get("title"), after_chapter: chapter.id,
      }));
      navigate(id);
    });
    bind(actions.querySelector(".chapter-delete-form"), async () => {
      await value(client.from("sapgu_chapters").delete().eq("id", chapter.id).select("id").single());
      navigate(page.chapter_id === chapter.id ? undefined : page.id);
    }, {flush: page.chapter_id !== chapter.id, question: "이 챕터와 페이지를 삭제할까요?"});
    return group;
  }));

  document.title = `${book.title} · 필기`;
  app.dataset.currentPageId = page.id;
  for (const [offset, side] of [[-1, "previous"], [1, "next"]]) {
    const adjacent = pages[pageIndex + offset];
    app.dataset[`${side}PageUrl`] = adjacent ? editorLink(book.id, adjacent.id) : "";
    document.getElementById(`${side}PageButton`).disabled = !adjacent;
  }
  const paper = document.getElementById("paper");
  paper.dataset.template = page.paper_template;
  paperStyle(paper, page);
  paperStyle(document.getElementById("currentPaperSwatch"), page);
  const custom = app.querySelector('button[value="custom"]');
  custom.hidden = !page.paper_image;
  if (page.paper_image) paperStyle(custom.firstElementChild, {...page, paper_template: "custom"});
  bind(document.getElementById("uploadPaper"), async fields => {
    const image = await readPng(fields.get("paper_image"));
    if (!image) return;
    await value(client.from("sapgu_pages").update({paper_image: image, paper_template: "custom"})
      .eq("id", page.id).select("id").single());
    navigate(page.id);
  });
  const studyLink = app.querySelector(".editor-titlebar a");
  studyLink.href = `./study.html?book=${encodeURIComponent(book.id)}`;
  studyLink.addEventListener("click", async event => {
    event.preventDefault();
    if (await transport.flushPage?.()) location.href = studyLink.href;
  });
  document.getElementById("pageTitle").value = page.title;
  document.getElementById("recognizedText").value = page.recognized_text;
  document.getElementById("quizTerms").value = page.quiz_terms.join(", ");
  json("initial-ink", page.ink_data);
  json("initial-text-boxes", page.text_boxes);
  json("initial-sticky-notes", page.sticky_notes);
  json("recognition-blocks", page.recognition_blocks);
  json("recognition-uncertain", page.uncertain_ranges);
  if (preferences) json("drawing-preferences", preferences.settings);
  json("page-previews", pages.map(item => ({id: item.id, ink_data: item.ink_data, text_boxes: item.text_boxes, sticky_notes: item.sticky_notes})));
  document.querySelector(".site-main").hidden = false;
  await import("../notes-site/static/notes/editor.js");
  status.hidden = true;
}

start().catch(error => writeStatus(status, error.message || "공책을 불러오지 못했어요.", true));
