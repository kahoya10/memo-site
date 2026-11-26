const STORAGE_KEY = "paper-today-v1";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const isoDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const safeText = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const defaultState = {
  events: [],
  tasks: [],
  folders: [{ id: "inbox", name: "기본 노트" }],
  notes: [],
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      events: Array.isArray(saved?.events) ? saved.events : [],
      tasks: Array.isArray(saved?.tasks) ? saved.tasks : [],
      folders: Array.isArray(saved?.folders) && saved.folders.length ? saved.folders : defaultState.folders,
      notes: Array.isArray(saved?.notes) ? saved.notes : [],
    };
  } catch { return structuredClone(defaultState); }
}

let state = loadState();
let calendarDate = new Date();
let selectedDate = isoDate();
let activeFolder = state.folders[0]?.id || "inbox";
let activeNote = null;
let taskFilter = "all";
let saveTimer;

const overlay = $("#overlay");
const panelBody = $("#panelBody");
const panelTitle = $("#panelTitle");
const panelKicker = $("#panelKicker");
const toast = $("#toast");
const upcomingSchedule = $("#upcomingSchedule");
const plannerUrl = upcomingSchedule.getAttribute("href");

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateMeta();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-showing");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-showing"), 1900);
}

function dateLabel(value, withYear = false) {
  if (!value) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    ...(withYear ? { year: "numeric" } : {}), month: "long", day: "numeric", weekday: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function nearestPlannerSchedule(today) {
  const days = plannerStorage.read()?.days ?? {};
  const upcomingDates = Object.keys(days)
    .filter(date => date >= today && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  for (const date of upcomingDates) {
    const day = new Date(`${date}T00:00:00`);
    if (!Number.isFinite(day.getTime()) || isoDate(day) !== date) continue;
    const schedules = days[date]?.schedules;
    if (!Array.isArray(schedules)) continue;
    const first = schedules.find(item => !item?.done && typeof item?.text === "string" && item.text.trim());
    if (first) return {date, text: first.text.trim()};
  }
  return null;
}

function renderUpcomingSchedule() {
  const today = isoDate();
  const closest = nearestPlannerSchedule(today);
  const date = $("#upcomingScheduleDate");
  date.hidden = !closest;
  if (closest) {
    const label = dateLabel(closest.date, closest.date.slice(0, 4) !== today.slice(0, 4));
    date.dateTime = closest.date;
    date.textContent = closest.date === today ? `오늘 · ${label}` : label;
  } else {
    date.removeAttribute("datetime");
    date.textContent = "";
  }
  $("#upcomingScheduleTitle").textContent = closest?.text ?? "다가오는 일정이 없어요.";
  upcomingSchedule.href = closest ? `${plannerUrl}?date=${closest.date}` : plannerUrl;
  $("#calendarMeta").textContent = closest ? `가장 가까운 일정 · ${date.textContent} · ${closest.text}` : "다가오는 일정이 없어요.";
}

function updateMeta() {
  renderUpcomingSchedule();
  $("#scheduleMeta").textContent = "집중 시간을 재어보세요";
  const notebookCount = Number(document.body.dataset.notebookCount);
  $("#notesMeta").textContent = document.body.dataset.notebookCount !== undefined
    ? notebookCount > 0 ? `내 공책 ${notebookCount}권` : "첫 공책을 만들어 보세요"
    : "내 공책 열기";
}

function openWorkspace(type) {
  const names = {
    calendar: ["DAILY CALENDAR", "캘린더"], schedule: ["TO-DO LIST", "일정 정리표"],
    reminders: ["UPCOMING", "미리 알림"], notes: ["MY ARCHIVE", "나의 노트"],
  };
  [panelKicker.textContent, panelTitle.textContent] = names[type];
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  location.hash = type;
  ({ calendar: renderCalendar, schedule: renderSchedule, reminders: renderReminders, notes: renderNotes }[type])();
}

function closeWorkspace() {
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname + location.search);
}

function renderCalendar() {
  panelBody.innerHTML = `
    <div class="workspace-grid">
      <section class="surface surface-pad">
        <div class="calendar-toolbar"><div class="calendar-nav"><button data-month="-1" aria-label="이전 달">←</button><button data-month="0">오늘</button><button data-month="1" aria-label="다음 달">→</button></div><h3 id="calendarMonth"></h3></div>
        <div class="calendar-week">${["일","월","화","수","목","금","토"].map(d => `<span>${d}</span>`).join("")}</div>
        <div class="calendar-grid" id="calendarGrid"></div>
      </section>
      <aside class="surface surface-pad">
        <div class="section-title"><div><h3 id="selectedDateLabel"></h3><p>이날의 약속과 일정을 적어두세요.</p></div></div>
        <form class="inline-form" id="eventForm">
          <input name="title" required maxlength="80" placeholder="일정 이름" aria-label="일정 이름" />
          <div class="field-row"><input name="time" type="time" aria-label="시간" /><button class="primary-btn" type="submit">일정 추가</button></div>
        </form>
        <div class="item-list" id="eventList" style="margin-top:18px"></div>
      </aside>
    </div>`;
  drawCalendar();
  $$('[data-month]').forEach(button => button.addEventListener("click", () => {
    const amount = Number(button.dataset.month);
    calendarDate = amount === 0 ? new Date() : new Date(calendarDate.getFullYear(), calendarDate.getMonth() + amount, 1);
    if (amount === 0) selectedDate = isoDate();
    drawCalendar();
  }));
  $("#eventForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.events.push({ id: uid(), title: data.get("title").trim(), date: selectedDate, time: data.get("time") });
    saveState(); event.currentTarget.reset(); drawCalendar(); showToast("일정을 추가했어요.");
  });
}

function drawCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $("#calendarMonth").textContent = `${year}년 ${month + 1}월`;
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  $("#calendarGrid").innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index);
    const key = isoDate(day); const count = state.events.filter(item => item.date === key).length;
    return `<button class="day ${day.getMonth() !== month ? "is-outside" : ""} ${key === selectedDate ? "is-selected" : ""} ${key === isoDate() ? "is-today" : ""}" data-date="${key}"><span class="day-number">${day.getDate()}</span><span class="day-dots">${"<i></i>".repeat(Math.min(count,3))}</span></button>`;
  }).join("");
  $$(".day").forEach(button => button.addEventListener("click", () => { selectedDate = button.dataset.date; drawCalendar(); }));
  $("#selectedDateLabel").textContent = dateLabel(selectedDate, true);
  drawEventList();
}

function drawEventList() {
  const events = state.events.filter(item => item.date === selectedDate).sort((a,b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  $("#eventList").innerHTML = events.length ? events.map(item => `
    <div class="list-item"><i class="item-dot"></i><div class="item-copy"><strong>${safeText(item.title)}</strong><small>${item.time || "시간 미정"}</small></div><div class="item-actions"><button data-delete-event="${item.id}" aria-label="삭제">×</button></div></div>`).join("") : `<div class="empty">등록된 일정이 없어요.</div>`;
  $$('[data-delete-event]').forEach(button => button.addEventListener("click", () => {
    state.events = state.events.filter(item => item.id !== button.dataset.deleteEvent); saveState(); drawCalendar(); showToast("일정을 삭제했어요.");
  }));
}

function renderSchedule() {
  panelBody.innerHTML = `
    <div class="schedule-layout">
      <aside class="surface surface-pad">
        <div class="section-title"><div><h3>새 할 일</h3><p>중요도와 시간을 함께 정리해요.</p></div></div>
        <form class="inline-form" id="taskForm">
          <input name="title" required maxlength="80" placeholder="해야 할 일" />
          <label>날짜<input name="date" type="date" value="${isoDate()}" /></label>
          <div class="field-row"><label>시간<input name="time" type="time" /></label><label>중요도<select name="priority"><option value="medium">보통</option><option value="high">높음</option><option value="low">낮음</option></select></label></div>
          <button class="primary-btn" type="submit">할 일 추가</button>
        </form>
      </aside>
      <section class="surface surface-pad">
        <div class="section-title"><div><h3>나의 일정</h3><p id="taskSummary"></p></div><div class="filters"><button class="filter is-active" data-filter="all">전체</button><button class="filter" data-filter="open">할 일</button><button class="filter" data-filter="done">완료</button></div></div>
        <div class="item-list" id="taskList"></div>
      </section>
    </div>`;
  $("#taskForm").addEventListener("submit", event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    state.tasks.unshift({ id: uid(), title: data.get("title").trim(), date: data.get("date"), time: data.get("time"), priority: data.get("priority"), done: false });
    saveState(); event.currentTarget.reset(); event.currentTarget.elements.date.value = isoDate(); drawTasks(); showToast("할 일을 추가했어요.");
  });
  $$("[data-filter]").forEach(button => button.addEventListener("click", () => {
    taskFilter = button.dataset.filter; $$("[data-filter]").forEach(item => item.classList.toggle("is-active", item === button)); drawTasks();
  }));
  drawTasks();
}

function drawTasks() {
  const filtered = state.tasks.filter(item => taskFilter === "all" || (taskFilter === "done" ? item.done : !item.done));
  $("#taskSummary").textContent = `${state.tasks.filter(item => !item.done).length}개 남음 · ${state.tasks.filter(item => item.done).length}개 완료`;
  $("#taskList").innerHTML = filtered.length ? filtered.map(item => `
    <div class="list-item ${item.done ? "is-done" : ""}"><input class="check-button" data-toggle-task="${item.id}" type="checkbox" ${item.done ? "checked" : ""} aria-label="완료 표시"/><div class="item-copy"><strong>${safeText(item.title)}</strong><small>${dateLabel(item.date)}${item.time ? ` · ${item.time}` : ""} · ${ {high:"중요",medium:"보통",low:"여유"}[item.priority] }</small></div><div class="item-actions"><i class="item-dot priority-${item.priority}"></i><button data-delete-task="${item.id}" aria-label="삭제">×</button></div></div>`).join("") : `<div class="empty">표시할 일정이 없어요.</div>`;
  $$('[data-toggle-task]').forEach(input => input.addEventListener("change", () => { const task = state.tasks.find(item => item.id === input.dataset.toggleTask); task.done = input.checked; saveState(); drawTasks(); }));
  $$('[data-delete-task]').forEach(button => button.addEventListener("click", () => { state.tasks = state.tasks.filter(item => item.id !== button.dataset.deleteTask); saveState(); drawTasks(); showToast("할 일을 삭제했어요."); }));
}

function renderReminders() {
  const today = isoDate();
  const reminders = [
    ...state.events.map(item => ({ ...item, kind: "일정", done: false })),
    ...state.tasks.filter(item => !item.done && item.date).map(item => ({ ...item, kind: "할 일" })),
  ].filter(item => item.date >= today).sort((a,b) => `${a.date}${a.time || "99:99"}`.localeCompare(`${b.date}${b.time || "99:99"}`));
  const grouped = Object.groupBy ? Object.groupBy(reminders, item => item.date) : reminders.reduce((all,item) => ((all[item.date] ||= []).push(item), all), {});
  panelBody.innerHTML = `<section class="surface surface-pad" style="max-width:760px;margin:auto;min-height:100%"><div class="section-title"><div><h3>다가오는 일정</h3><p>캘린더와 일정 정리표의 중요한 내용을 날짜순으로 모았어요.</p></div></div><div id="reminderList">${reminders.length ? Object.entries(grouped).map(([date,items]) => `<p class="reminder-date">${date === today ? "오늘 · " : ""}${dateLabel(date,true)}</p><div class="item-list">${items.map(item => `<div class="list-item"><i class="item-dot ${item.priority ? `priority-${item.priority}` : ""}"></i><div class="item-copy"><strong>${safeText(item.title)}</strong><small>${item.kind}${item.time ? ` · ${item.time}` : " · 시간 미정"}</small></div></div>`).join("")}</div>`).join("") : `<div class="empty">다가오는 알림이 없어요.<br>캘린더나 일정 정리표에서 새 일정을 추가해 보세요.</div>`}</div></section>`;
}

function renderNotes() {
  if (!state.folders.some(folder => folder.id === activeFolder)) activeFolder = state.folders[0].id;
  const folderNotes = state.notes.filter(note => note.folderId === activeFolder).sort((a,b) => b.updated.localeCompare(a.updated));
  if (!folderNotes.some(note => note.id === activeNote)) activeNote = folderNotes[0]?.id || null;
  panelBody.innerHTML = `
    <section class="surface notes-surface" style="height:100%">
      <div class="notes-layout">
        <aside class="notes-column"><div class="column-head"><h3>폴더</h3><button class="mini-add" id="addFolder" aria-label="폴더 추가">+</button></div><div id="folderList">${state.folders.map(folder => `<button class="folder-button ${folder.id === activeFolder ? "is-active" : ""}" data-folder="${folder.id}">${safeText(folder.name)}<span>${state.notes.filter(note => note.folderId === folder.id).length}</span></button>`).join("")}</div></aside>
        <aside class="notes-column"><div class="column-head"><h3>노트</h3><button class="mini-add" id="addNote" aria-label="노트 추가">+</button></div><div id="noteList">${folderNotes.length ? folderNotes.map(note => `<button class="note-button ${note.id === activeNote ? "is-active" : ""}" data-note="${note.id}"><strong>${safeText(note.title || "제목 없는 노트")}</strong><small>${safeText((note.content || "내용 없음").slice(0,28))}</small></button>`).join("") : `<div class="empty">노트가 없어요.</div>`}</div></aside>
        <main class="notes-column" id="noteEditor">${noteEditorMarkup()}</main>
      </div>
    </section>`;
  $("#addFolder").addEventListener("click", addFolder);
  $("#addNote").addEventListener("click", addNote);
  $$('[data-folder]').forEach(button => button.addEventListener("click", () => { activeFolder = button.dataset.folder; activeNote = null; renderNotes(); }));
  $$('[data-note]').forEach(button => button.addEventListener("click", () => { activeNote = button.dataset.note; renderNotes(); }));
  bindNoteEditor();
}

function noteEditorMarkup() {
  const note = state.notes.find(item => item.id === activeNote);
  if (!note) return `<div class="empty">+ 버튼을 눌러 새 노트를 시작하세요.</div>`;
  return `<div class="note-editor"><input class="note-title" id="noteTitle" maxlength="100" value="${safeText(note.title)}" placeholder="노트 제목"/><textarea class="note-content" id="noteContent" placeholder="생각을 자유롭게 적어보세요.">${safeText(note.content)}</textarea><div class="editor-status"><span id="saveStatus">자동 저장됨</span><button class="danger-btn" id="deleteNote">노트 삭제</button></div></div>`;
}

function bindNoteEditor() {
  const title = $("#noteTitle"); if (!title) return;
  const content = $("#noteContent");
  [title, content].forEach(input => input.addEventListener("input", () => {
    const note = state.notes.find(item => item.id === activeNote);
    note.title = title.value; note.content = content.value; note.updated = new Date().toISOString();
    $("#saveStatus").textContent = "저장 중…"; clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveState(); $("#saveStatus").textContent = "자동 저장됨"; }, 450);
  }));
  $("#deleteNote").addEventListener("click", () => {
    if (!confirm("이 노트를 삭제할까요?")) return;
    state.notes = state.notes.filter(note => note.id !== activeNote); activeNote = null; saveState(); renderNotes(); showToast("노트를 삭제했어요.");
  });
}

function addFolder() {
  const name = prompt("새 폴더 이름을 입력해 주세요.");
  if (!name?.trim()) return;
  const folder = { id: uid(), name: name.trim().slice(0,40) }; state.folders.push(folder); activeFolder = folder.id; activeNote = null; saveState(); renderNotes();
}

function addNote() {
  const note = { id: uid(), folderId: activeFolder, title: "새 노트", content: "", updated: new Date().toISOString() };
  state.notes.unshift(note); activeNote = note.id; saveState(); renderNotes(); setTimeout(() => $("#noteTitle")?.select(), 0);
}

function startDogAnimation() {
  const frames = $$(".dog-frame");
  if (frames.length < 2) return;
  let activeIndex = 0;
  frames.forEach((frame, index) => frame.classList.toggle("is-active", index === activeIndex));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.setInterval(() => {
    frames[activeIndex].classList.remove("is-active");
    activeIndex = (activeIndex + 1) % frames.length;
    frames[activeIndex].classList.add("is-active");
  }, 400);
}

function setupProfileAvatar() {
  const avatar = $("#profileAvatar");
  const chooser = $("#profileChooser");
  const input = $("#profileAvatarInput");
  const preview = $("#profileAvatarPreview");
  const selectionButtons = $$("[data-profile-character]", chooser);
  const photoOption = $('[data-profile-character="photo"]', chooser);
  const message = $("#profileChooserMessage");
  const upload = $("#profileUpload");
  const userKey = document.body.dataset.profileUser;
  const photoKey = `paper-profile-avatar:${userKey}`;
  const selectionKey = `paper-profile-avatar-choice:${userKey}`;
  let photo = null;
  let selection = "initial";
  let uploadVersion = 0;

  try {
    const storedPhoto = localStorage.getItem(photoKey);
    if (storedPhoto?.startsWith("data:image/jpeg;base64,")) photo = storedPhoto;
    selection = localStorage.getItem(selectionKey) || (photo ? "photo" : "initial");
  } catch {
    // The chooser can still be used for the current page.
  }

  const renderSelection = () => {
    const character = selectionButtons.find(button => button.dataset.profileCharacter === selection);
    const source = selection === "photo" ? photo : character?.querySelector("img")?.src;
    if (source) preview.src = source;
    else {
      preview.removeAttribute("src");
      selection = "initial";
    }
    avatar.classList.toggle("has-image", Boolean(source));
    photoOption.hidden = !photo;
    selectionButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.profileCharacter === selection));
    });
  };

  function chooseAvatar(value, newPhoto = null) {
    selection = value;
    if (newPhoto) photo = newPhoto;
    let stored = true;
    try {
      if (newPhoto) localStorage.setItem(photoKey, newPhoto);
      localStorage.setItem(selectionKey, selection);
    } catch {
      stored = false;
    }
    renderSelection();
    chooser.close();
    showToast(stored ? "프로필을 바꿨어요." : "이번 화면에 프로필을 적용했어요.");
  }

  renderSelection();
  avatar.addEventListener("click", () => {
    uploadVersion++;
    message.hidden = true;
    upload.disabled = false;
    chooser.showModal();
    $('[aria-pressed="true"]', chooser)?.focus();
  });
  selectionButtons.forEach(button => {
    button.addEventListener("click", () => chooseAvatar(button.dataset.profileCharacter));
  });
  upload.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const version = ++uploadVersion;
    message.hidden = true;
    upload.disabled = true;
    const sourceUrl = URL.createObjectURL(file);
    try {
      const source = new Image();
      source.src = sourceUrl;
      await source.decode();
      if (version === uploadVersion && chooser.open) {
        const size = 256;
        const crop = Math.min(source.naturalWidth, source.naturalHeight);
        const x = (source.naturalWidth - crop) / 2;
        const y = (source.naturalHeight - crop) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.getContext("2d").drawImage(source, x, y, crop, crop, 0, 0, size, size);
        chooseAvatar("photo", canvas.toDataURL("image/jpeg", .86));
      }
    } catch {
      if (version === uploadVersion && chooser.open) {
        message.textContent = "사진을 불러오지 못했어요. 다른 이미지 파일을 골라 주세요.";
        message.hidden = false;
      }
    } finally {
      URL.revokeObjectURL(sourceUrl);
      if (version === uploadVersion) upload.disabled = false;
    }
  });
}

$("#todayChip").textContent = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
startDogAnimation();
setupProfileAvatar();
$$('[data-open]').forEach(button => button.addEventListener("click", () => openWorkspace(button.dataset.open)));
$("#closePanel").addEventListener("click", closeWorkspace);
$("#goHome").addEventListener("click", closeWorkspace);
overlay.addEventListener("click", event => { if (event.target === overlay) closeWorkspace(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && overlay.classList.contains("is-open")) closeWorkspace(); });
window.addEventListener("beforeunload", saveState);
window.addEventListener("storage", event => {
  if (event.key === plannerStorage.key || event.key === null) renderUpcomingSchedule();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) window.location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderUpcomingSchedule();
});
updateMeta();
if (["calendar","schedule","reminders","notes"].includes(location.hash.slice(1))) openWorkspace(location.hash.slice(1));
