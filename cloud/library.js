import {editorLink, pngUrl, readPng, supabaseClient, value, writeStatus} from "./api.js";

const byId = id => document.getElementById(id);
const status = byId("cloudStatus");
const form = byId("notebookForm");
const dialog = byId("notebookDialog");
const colors = {
  blue: "청회색", coral: "붉은 흙색", green: "잎새색", violet: "보라색", gold: "황토색",
  slate: "먹청색", hanji: "서당 한지", linen: "오트밀 리넨", marble: "푸른 마블",
  gingham: "세이지 체크", orchard: "살구꽃", moon: "달밤", frame: "고전 문양", waves: "청록 물결", geo: "황토 기하학",
};
let client;
let editing = null;
let coverUrls = [];

for (const [style, name] of Object.entries(colors)) {
  const option = document.createElement("label");
  option.className = "cover-option";
  option.title = name;
  option.innerHTML = `<input class="sr-only" name="style" type="radio" value="${style}" aria-label="${name}" required><span class="template-tile"><span class="template-sheet cover-swatch cover-${style}"></span></span>`;
  byId("coverOptions").append(option);
}

function openBook(book = null) {
  editing = book;
  form.reset();
  form.elements.title.value = book?.title ?? "";
  form.elements.subject.value = book?.subject ?? "";
  form.elements.style.value = book?.cover_style ?? "blue";
  byId("notebookDialogTitle").textContent = book ? "표지 변경" : "공책 만들기";
  writeStatus(byId("notebookStatus"), "");
  dialog.showModal();
}

async function renderBooks() {
  const books = await value(client.from("sapgu_notebooks").select("*").order("updated_at", {ascending: false}));
  const query = byId("notebook-search").value.trim().toLocaleLowerCase();
  let matchIds = new Set();
  if (query) {
    const pages = await value(client.from("sapgu_pages").select("title,recognized_text,text_content,text_boxes,sticky_notes,sapgu_chapters(notebook_id)"));
    matchIds = new Set(pages.filter(page => [page.title, page.recognized_text, page.text_content,
      ...page.text_boxes.map(item => item.text), ...page.sticky_notes.map(item => item.text)]
      .some(text => String(text ?? "").toLocaleLowerCase().includes(query)))
      .map(page => page.sapgu_chapters?.notebook_id));
  }
  const shown = books.filter(book => !query || matchIds.has(book.id) ||
    `${book.title}\n${book.subject}`.toLocaleLowerCase().includes(query));
  coverUrls.forEach(url => URL.revokeObjectURL(url));
  coverUrls = [];
  const cards = shown.map(book => {
    const fragment = byId("notebookCard").content.cloneNode(true);
    const cover = fragment.querySelector(".a4-cover");
    cover.href = fragment.querySelector("[data-edit]").href = editorLink(book.id);
    cover.classList.add(`cover-${book.cover_style}`);
    const image = pngUrl(book.cover_image);
    if (image) {
      coverUrls.push(image);
      cover.classList.add("cover-uploaded");
      cover.style.backgroundImage = `url(${image})`;
    }
    cover.querySelector(".cover-subject").textContent = book.subject;
    cover.querySelector("strong").textContent = book.title;
    cover.querySelector("small").textContent = `${new Date(book.updated_at).toLocaleDateString("ko-KR")} 수정`;
    fragment.querySelector("[data-study]").href = `./study.html?book=${encodeURIComponent(book.id)}`;
    fragment.querySelector("[data-organize]").href = `./organize.html?book=${encodeURIComponent(book.id)}`;
    fragment.querySelector("[data-cover]").addEventListener("click", () => openBook(book));
    fragment.querySelector("[data-remove]").addEventListener("click", async () => {
      if (!confirm("이 공책과 모든 페이지를 삭제할까요?")) return;
      try {
        await value(client.from("sapgu_notebooks").delete().eq("id", book.id).select("id").single());
        await renderBooks();
      } catch (error) { writeStatus(status, error.message, true); }
    });
    return fragment;
  });
  byId("notebooks").replaceChildren(...cards);
  byId("noBooks").hidden = shown.length > 0;
  byId("noBooksTitle").textContent = query ? "찾는 공책이 없어요" : "첫 공책을 펼쳐 볼까요?";
  const empty = new URLSearchParams(location.search).get("empty");
  if (empty && books.some(book => book.id === empty)) {
    history.replaceState(null, "", location.pathname);
    const page = await value(client.rpc("sapgu_new_chapter", {book: empty, chapter_title: "첫 번째 챕터"}));
    location.replace(editorLink(empty, page));
  }
}

async function showAccount() {
  const {session} = await value(client.auth.getSession());
  byId("signInPanel").hidden = Boolean(session);
  byId("signOut").parentElement.hidden = !session;
  byId("library").hidden = byId("invitePanel").hidden = true;
  byId("inviteButton").hidden = true;
  document.querySelector("#libraryActions [data-open-notebook]").hidden = true;
  if (!session) return;
  const member = await value(client.from("sapgu_members").select("is_admin").maybeSingle());
  byId("invitePanel").hidden = Boolean(member);
  if (!member) return;
  byId("inviteButton").hidden = !member.is_admin;
  document.querySelector("#libraryActions [data-open-notebook]").hidden = false;
  byId("library").hidden = false;
  await renderBooks();
}

function submit(id, callback, output = status) {
  byId(id).addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    if (button) button.disabled = true;
    writeStatus(output, "");
    try { await callback(new FormData(event.currentTarget), button?.value); }
    catch (error) { writeStatus(output, error.message || "다시 시도해 주세요.", true); }
    finally { if (button) button.disabled = false; }
  });
}

async function start() {
  client = supabaseClient();
  document.querySelectorAll("[data-open-notebook]").forEach(button => button.addEventListener("click", () => openBook()));
  byId("closeNotebook").addEventListener("click", () => dialog.close());
  byId("signOut").addEventListener("click", async () => {
    try { await value(client.auth.signOut()); await showAccount(); writeStatus(status, "로그아웃했어요."); }
    catch (error) { writeStatus(status, error.message, true); }
  });
  byId("inviteButton").addEventListener("click", async () => {
    try {
      const code = await value(client.rpc("sapgu_create_invite"));
      writeStatus(status, `초대 코드 ${code} · 한 번 사용 가능, 7일 후 만료`);
    } catch (error) { writeStatus(status, error.message, true); }
  });
  submit("accountForm", async (fields, action) => {
    const credentials = {email: fields.get("email").trim(), password: fields.get("password")};
    if (action === "signup") {
      const result = await value(client.auth.signUp({...credentials, options: {emailRedirectTo: new URL("./index.html", location.href).href}}));
      if (!result.session) return writeStatus(status, "이메일 확인 링크를 연 뒤 로그인해 주세요.");
    } else {
      await value(client.auth.signInWithPassword(credentials));
    }
    byId("accountForm").reset();
    await showAccount();
  });
  submit("inviteForm", async fields => {
    const code = fields.get("code").trim();
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(code)) throw new Error("초대 코드를 확인해 주세요.");
    await value(client.rpc("sapgu_redeem_invite", {invite_code: code}));
    await showAccount();
  });
  submit("notebookForm", async fields => {
    const title = fields.get("title").trim();
    const subject = fields.get("subject").trim();
    const cover = fields.get("style");
    const image = await readPng(fields.get("cover"));
    if (!title || !subject) throw new Error("공책 제목과 과목을 적어 주세요.");
    if (editing) {
      const changes = {title, subject, cover_style: cover, updated_at: new Date().toISOString()};
      if (image) changes.cover_image = image;
      await value(client.from("sapgu_notebooks").update(changes).eq("id", editing.id).select("id").single());
      dialog.close();
      await renderBooks();
      return;
    }
    const book = await value(client.rpc("sapgu_new_notebook", {book_title: title, book_subject: subject, book_cover: cover, book_png: image}));
    location.href = editorLink(book);
  }, byId("notebookStatus"));
  submit("bookSearch", renderBooks);
  await showAccount();
  writeStatus(status, "");
}

start().catch(error => writeStatus(status, error.message, true));
