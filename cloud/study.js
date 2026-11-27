import {editorLink, openNotebook, pngUrl, supabaseClient, value, writeStatus} from "./api.js";

const status = document.getElementById("cloudStatus");

function regions(strokes, role) {
  const items = [];
  const seen = new Set();
  for (const [index, stroke] of strokes.entries()) {
    if (stroke?.study_role !== role || (role === "blank" && stroke.tool !== "highlighter")) continue;
    const points = (stroke.points ?? []).filter(point => Array.isArray(point) && point.length >= 2 &&
      point.slice(0, 2).every(coordinate => Number.isFinite(coordinate) && coordinate >= -1 && coordinate <= 2));
    if (!points.length) continue;
    const width = Math.min(40, Math.max(1, Number(stroke.width) || 18));
    const insetX = Math.max(.012, width / 794);
    const insetY = Math.max(.015, width / 1123);
    const topInset = role === "card" && stroke.tool !== "highlighter" ? Math.max(.025, insetY) : insetY;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const bounds = [Math.max(0, minX - insetX), Math.max(0, minY - topInset), Math.min(1, maxX + insetX), Math.min(1, maxY + insetY)];
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) continue;
    let id = String(stroke.id || index).slice(0, 80);
    while (seen.has(id)) id = `${index}:${id}`.slice(0, 80);
    seen.add(id);
    items.push({id, bounds});
    if (items.length === 100) break;
  }
  return items;
}

async function start() {
  const client = supabaseClient();
  const opened = await openNotebook(client, new URLSearchParams(location.search).get("book"));
  if (!opened) return;
  const {book} = opened;
  const app = document.getElementById("studyApp");
  const pages = book.sapgu_chapters.flatMap(chapter => chapter.sapgu_pages.map(page => ({
    id: page.id, chapter: chapter.title, title: page.title, ink: page.ink_data,
    text: page.recognized_text, terms: page.recognized_text ? page.quiz_terms : [],
    blanks: regions(page.ink_data, "blank"), cards: regions(page.ink_data, "card"),
    paper: page.paper_template, paper_url: page.paper_template === "custom" ? pngUrl(page.paper_image) : "",
  }))).filter(page => page.terms.length || page.blanks.length || page.cards.length);
  app.querySelector(".back-link").href = "./index.html";
  app.querySelector(".page-heading > a").href = editorLink(book.id);
  app.querySelector("h1").textContent = `${book.title} 학습`;
  document.getElementById("study-data").textContent = JSON.stringify(pages);
  const attempts = await value(client.from("sapgu_attempts").select("*").eq("notebook_id", book.id)
    .order("created_at", {ascending: false}).limit(12));
  if (attempts.length) {
    const records = app.querySelector(".quiz-records");
    const list = document.createElement("ul");
    const labels = {blank: "빈칸", card: "카드 매치", speed: "스피드 퀴즈"};
    for (const attempt of attempts) {
      const item = document.createElement("li");
      const count = attempt.results.filter(result => result.correct).length;
      item.textContent = `${new Date(attempt.created_at).toLocaleString("ko-KR")} · ${labels[attempt.mode]} · ${count}/${attempt.results.length} · ${attempt.duration_seconds}초`;
      list.append(item);
    }
    records.querySelector("p")?.remove();
    records.append(list);
  }
  window.sapguSaveQuiz = attempt => value(client.from("sapgu_attempts").upsert({
    id: attempt.id, notebook_id: book.id, mode: attempt.mode, duration_seconds: attempt.duration, results: attempt.results,
  }, {onConflict: "id", ignoreDuplicates: true}));
  document.querySelector(".site-main").hidden = false;
  await import("../notes-site/static/notes/study.js");
  status.hidden = true;
}

start().catch(error => writeStatus(status, error.message || "학습 화면을 열지 못했어요.", true));
