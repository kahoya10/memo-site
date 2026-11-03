const SUBJECTS = {
  korean: { label: "국어", color: "#789ab9" },
  math: { label: "수학", color: "#9aaf91" },
  english: { label: "영어", color: "#c99585" },
  science: { label: "과학", color: "#a9a0c5" },
  social: { label: "사회", color: "#d3aa72" },
  etc: { label: "기타", color: "#9d8d7e" },
};
const SUBJECT_KEYS = Object.keys(SUBJECTS);
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const STORAGE_KEY = "steady-planner-rebuild-v1";
const PLANNER_INK_STORAGE_KEY = "steady-planner-ink-v1";
const DRAG_MINUTE_UNIT = 5;

const PLANNER_INK_PALETTES = {
  basic: { label: "기본", colors: ["#4f6680", "#383b40", "#a86661", "#6d896f", "#c28f43"] },
  pastel: { label: "파스텔", colors: ["#65b9ec", "#ee88b5", "#f2b34d", "#70c77d", "#ae88e8"] },
  marker: { label: "마커", colors: ["#f1b24a", "#f07e75", "#79b6d2", "#88c27a", "#b18fd1"] },
  neon: { label: "네온", colors: ["#ff4f81", "#ff9f1c", "#00b8d9", "#55c91f", "#a855f7"] },
  nature: { label: "자연", colors: ["#315c4b", "#6f8f72", "#b27658", "#557a9f", "#9b8065"] },
};
const plannerInkEditors = new Map();
let plannerInkToolsEnabled = false;

const els = {
  shell: document.querySelector(".planner-shell"),
  periodTitle: document.querySelector("#periodTitle"),
  focusDateLabel: document.querySelector("#focusDateLabel"),
  previousPeriod: document.querySelector("#previousPeriod"),
  nextPeriod: document.querySelector("#nextPeriod"),
  todayButton: document.querySelector("#todayButton"),
  monthView: document.querySelector("#monthView"),
  weekView: document.querySelector("#weekView"),
  dayView: document.querySelector("#dayView"),
  todoCardTitle: document.querySelector("#todoCardTitle"),
  todoDateLabel: document.querySelector("#todoDateLabel"),
  todoList: document.querySelector("#todoList"),
  dayScheduleDateLabel: document.querySelector("#dayScheduleDateLabel"),
  dayScheduleList: document.querySelector("#dayScheduleList"),
  sideColumn: document.querySelector(".side-column"),
  memoCard: document.querySelector("#memoCard"),
  memoInput: document.querySelector("#memoInput"),
  feedbackInput: document.querySelector("#feedbackInput"),
  dailyTotalStudy: document.querySelector("#dailyTotalStudy"),
  studyDateLabel: document.querySelector("#studyDateLabel"),
  studyTotal: document.querySelector("#studyTotal"),
  studyPeriodLabel: document.querySelector("#studyPeriodLabel"),
  studyPie: document.querySelector("#studyPie"),
  studyLegend: document.querySelector("#studyLegend"),
  subjectSelect: document.querySelector("#subjectSelect"),
  scheduleDialog: document.querySelector("#scheduleDialog"),
  scheduleDialogDate: document.querySelector("#scheduleDialogDate"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleInput: document.querySelector("#scheduleInput"),
  scheduleCancel: document.querySelector("#scheduleCancel"),
  timeBlockDialog: document.querySelector("#timeBlockDialog"),
  timeBlockRange: document.querySelector("#timeBlockRange"),
  timeBlockForm: document.querySelector("#timeBlockForm"),
  timeBlockTodoSelect: document.querySelector("#timeBlockTodoSelect"),
  timeBlockCancel: document.querySelector("#timeBlockCancel"),
};

// Keep the monthly checklist and study log in one layout group.  In the day
// and week views the wrapper is transparent, so their existing grid placement
// stays unchanged.
function groupMonthStudyCards() {
  const todo = els.sideColumn.querySelector(".todo-card");
  const study = els.sideColumn.querySelector(".study-card");
  if (!todo || !study || els.sideColumn.querySelector(".month-study-group")) return;
  const group = document.createElement("div");
  group.className = "month-study-group";
  els.sideColumn.insertBefore(group, todo);
  group.append(todo, study);
}
groupMonthStudyCards();

function makeId() {
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}
function isoDate(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function fromIso(value) {
  const parts = value.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
function startOfWeek(date) {
  const result = new Date(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}
function dateLabel(key, includeYear) {
  const date = fromIso(key);
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  return (includeYear ? date.getFullYear() + "년 " : "") + (date.getMonth() + 1) + "월 " + date.getDate() + "일 (" + weekday + ")";
}
function emptyDay() {
  return { todos: [], schedules: [], timeBlocks: [], timeBlockRedo: [], memo: "", feedback: "" };
}
function loadState() {
  const today = isoDate(new Date());
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && ["month", "week", "day"].includes(saved.view) && saved.focusDate && saved.days) return saved;
  } catch (error) {
    // Start with a clean state when storage is unavailable.
  }
  return { view: "month", focusDate: today, days: {} };
}

const state = loadState();
if (!state.weekGoals || typeof state.weekGoals !== "object") state.weekGoals = {};
if (!state.dailyGoals || typeof state.dailyGoals !== "object") state.dailyGoals = { weekday: 0, weekend: 0 };
if (!state.periodMemos || typeof state.periodMemos !== "object") state.periodMemos = {};
let pendingTimeBlock = null;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* memory-only fallback */ }
}
function getDay(key) {
  if (!state.days[key] || typeof state.days[key] !== "object") state.days[key] = emptyDay();
  const day = state.days[key];
  if (!Array.isArray(day.todos)) day.todos = [];
  if (!Array.isArray(day.schedules)) day.schedules = [];
  if (!Array.isArray(day.timeBlocks)) day.timeBlocks = [];
  if (!Array.isArray(day.timeBlockRedo)) day.timeBlockRedo = [];
  if (typeof day.memo !== "string") day.memo = "";
  if (typeof day.feedback !== "string") day.feedback = "";
  return day;
}
function periodDateKeys() {
  const date = fromIso(state.focusDate);
  if (state.view === "day") return [state.focusDate];
  if (state.view === "week") {
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, function(_, index) { return isoDate(addDays(start, index)); });
  }
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, function(_, index) { return isoDate(addDays(first, index)); });
}
function studyFromTimeBlocks(day) {
  return day.timeBlocks.reduce(function(summary, block) {
    const start = Number(block.start);
    const end = Number(block.end);
    const minutes = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
    if (minutes) summary[block.subject] = (summary[block.subject] || 0) + minutes;
    return summary;
  }, {});
}
function dailyGoalMinutes(key) {
  const date = fromIso(key);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  return Number(state.dailyGoals[isWeekend ? "weekend" : "weekday"] || 0);
}
function dailyGoalReached(key) {
  const goal = dailyGoalMinutes(key);
  return goal > 0 && totalMinutes(studyFromTimeBlocks(getDay(key))) >= goal;
}
function periodStudy() {
  return periodDateKeys().reduce(function(summary, key) {
    Object.entries(studyFromTimeBlocks(getDay(key))).forEach(function(entry) {
      summary[entry[0]] = (summary[entry[0]] || 0) + entry[1];
    });
    return summary;
  }, {});
}
function totalMinutes(summary) {
  return Object.values(summary).reduce(function(sum, value) { return sum + value; }, 0);
}
function durationLabel(minutes) {
  return Math.floor(minutes / 60) + "시간 " + String(Math.round(minutes % 60)).padStart(2, "0") + "분";
}
function shortDuration(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(Math.round(minutes % 60)).padStart(2, "0");
}
function studyLabel() {
  return state.view === "month" ? "이번달 공부" : state.view === "week" ? "이번주 공부" : "오늘 공부";
}
function periodMemoKey() {
  const date = fromIso(state.focusDate);
  if (state.view === "week") return "week:" + isoDate(startOfWeek(date));
  return "month:" + date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}
function currentMemo() {
  if (state.view === "day") return getDay(state.focusDate).memo;
  return state.periodMemos[periodMemoKey()] || "";
}
function saveCurrentMemo(value) {
  if (state.view === "day") getDay(state.focusDate).memo = value;
  else state.periodMemos[periodMemoKey()] = value;
  saveState();
}

function plannerInkStorageKey(field) {
  const period = state.view === "day" ? "day:" + state.focusDate : "period:" + periodMemoKey();
  return period + ":" + field;
}
function loadPlannerInk(field) {
  try {
    const saved = JSON.parse(localStorage.getItem(PLANNER_INK_STORAGE_KEY) || "{}");
    const strokes = saved[plannerInkStorageKey(field)];
    return Array.isArray(strokes) ? strokes : [];
  } catch (error) {
    return [];
  }
}
function savePlannerInk(field, strokes) {
  try {
    const saved = JSON.parse(localStorage.getItem(PLANNER_INK_STORAGE_KEY) || "{}");
    saved[plannerInkStorageKey(field)] = strokes;
    localStorage.setItem(PLANNER_INK_STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    // Drawing remains available for the current page when storage is unavailable.
  }
}
function plannerInkPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    pressure: event.pressure || 0.5,
  };
}
function drawPlannerInkStroke(context, stroke) {
  if (!stroke || !stroke.points || !stroke.points.length) return;
  const points = stroke.points;
  context.save();
  context.strokeStyle = stroke.color || "#4f6680";
  context.fillStyle = stroke.color || "#4f6680";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Number(stroke.size) || 4;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.restore();
}
function resizePlannerInk(editorState) {
  const canvas = editorState.canvas;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  editorState.strokes.forEach(function(stroke) { drawPlannerInkStroke(context, stroke); });
}
function refreshPlannerInkEditors() {
  plannerInkEditors.forEach(function(editorState) {
    editorState.strokes = loadPlannerInk(editorState.field);
    if (editorState.mode === "ink") window.requestAnimationFrame(function() { resizePlannerInk(editorState); });
  });
}
function setPlannerInkMode(editorState, mode) {
  editorState.mode = mode;
  editorState.editor.dataset.mode = mode;
  editorState.textarea.hidden = mode !== "text";
  editorState.canvas.hidden = mode !== "ink";
  editorState.palette.hidden = mode !== "ink";
  editorState.modes.forEach(function(button) { button.classList.toggle("is-active", button.dataset.inkMode === mode); });
  if (mode === "ink") window.requestAnimationFrame(function() { resizePlannerInk(editorState); });
}
function buildPlannerInkPalette(editorState) {
  const palette = editorState.palette;
  palette.replaceChildren();
  const paletteMenu = document.createElement("div");
  paletteMenu.className = "planner-palette-menu";
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "planner-palette-button";
  menuButton.textContent = PLANNER_INK_PALETTES[editorState.paletteName].label + " ▾";
  menuButton.setAttribute("aria-label", "펜 팔레트 선택");
  const popup = document.createElement("div");
  popup.className = "planner-palette-popup";
  Object.entries(PLANNER_INK_PALETTES).forEach(function(entry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "planner-palette-option";
    button.textContent = entry[1].label;
    button.classList.toggle("is-selected", entry[0] === editorState.paletteName);
    button.addEventListener("click", function() {
      editorState.paletteName = entry[0];
      editorState.color = PLANNER_INK_PALETTES[entry[0]].colors[0];
      buildPlannerInkPalette(editorState);
      popup.classList.remove("is-open");
    });
    popup.append(button);
  });
  menuButton.addEventListener("click", function(event) {
    event.stopPropagation();
    document.querySelectorAll(".planner-palette-popup.is-open").forEach(function(other) { if (other !== popup) other.classList.remove("is-open"); });
    popup.classList.toggle("is-open");
  });
  paletteMenu.append(menuButton, popup);
  const colors = document.createElement("div");
  colors.className = "planner-palette-colors";
  PLANNER_INK_PALETTES[editorState.paletteName].colors.forEach(function(color) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "planner-color-swatch";
    button.style.background = color;
    button.classList.toggle("is-selected", color === editorState.color);
    button.setAttribute("aria-label", "펜 색상 " + color);
    button.addEventListener("click", function() { editorState.color = color; buildPlannerInkPalette(editorState); });
    colors.append(button);
  });
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "planner-ink-action";
  undo.textContent = "↶";
  undo.setAttribute("aria-label", "펜 되돌리기");
  undo.addEventListener("click", function() {
    editorState.strokes.pop();
    savePlannerInk(editorState.field, editorState.strokes);
    resizePlannerInk(editorState);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "planner-ink-action";
  clear.textContent = "×";
  clear.setAttribute("aria-label", "펜 전체 지우기");
  clear.addEventListener("click", function() {
    editorState.strokes = [];
    savePlannerInk(editorState.field, editorState.strokes);
    resizePlannerInk(editorState);
  });
  palette.append(paletteMenu, colors, undo, clear);
}
function enablePlannerInkTools() {
  if (plannerInkToolsEnabled) return;
  plannerInkToolsEnabled = true;
  document.querySelectorAll(".planner-ink-controls").forEach(function(controls) { controls.hidden = false; });
}
function setupPlannerInkEditor(editor) {
  const field = editor.dataset.inkField;
  const textarea = editor.querySelector("textarea");
  const canvas = editor.querySelector(".planner-ink-canvas");
  const controls = editor.parentElement.querySelector(".planner-ink-controls");
  if (!field || !textarea || !canvas || !controls) return;
  const editorState = {
    field: field,
    editor: editor,
    textarea: textarea,
    canvas: canvas,
    controls: controls,
    palette: controls.querySelector(".planner-ink-palette"),
    modes: Array.from(controls.querySelectorAll("[data-ink-mode]")),
    mode: "text",
    paletteName: "basic",
    color: PLANNER_INK_PALETTES.basic.colors[0],
    strokes: loadPlannerInk(field),
    activeStroke: null,
  };
  plannerInkEditors.set(field, editorState);
  buildPlannerInkPalette(editorState);
  editorState.modes.forEach(function(button) { button.addEventListener("click", function() { setPlannerInkMode(editorState, button.dataset.inkMode); }); });
  canvas.addEventListener("pointerdown", function(event) {
    if (event.pointerType !== "pen") return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    editorState.activeStroke = { color: editorState.color, size: 4, points: [plannerInkPoint(event, canvas)] };
    const context = canvas.getContext("2d");
    if (context) { const ratio = Math.max(1, window.devicePixelRatio || 1); context.setTransform(ratio, 0, 0, ratio, 0, 0); drawPlannerInkStroke(context, editorState.activeStroke); }
  });
  canvas.addEventListener("pointermove", function(event) {
    if (!editorState.activeStroke || event.pointerType !== "pen") return;
    event.preventDefault();
    editorState.activeStroke.points.push(plannerInkPoint(event, canvas));
    const context = canvas.getContext("2d");
    if (context) { const ratio = Math.max(1, window.devicePixelRatio || 1); const rect = canvas.getBoundingClientRect(); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); editorState.strokes.forEach(function(stroke) { drawPlannerInkStroke(context, stroke); }); drawPlannerInkStroke(context, editorState.activeStroke); }
  });
  function finishStroke(event) {
    if (!editorState.activeStroke || (event && event.pointerType !== "pen")) return;
    editorState.strokes.push(editorState.activeStroke);
    editorState.activeStroke = null;
    savePlannerInk(editorState.field, editorState.strokes);
    resizePlannerInk(editorState);
  }
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
}
function setupPlannerInkEditors() {
  document.querySelectorAll(".planner-ink-editor").forEach(setupPlannerInkEditor);
  document.addEventListener("pointerdown", function(event) {
    if (event.pointerType === "pen") enablePlannerInkTools();
  }, { passive: true });
  document.addEventListener("pointerdown", function(event) {
    if (!event.target.closest(".planner-palette-menu")) document.querySelectorAll(".planner-palette-popup.is-open").forEach(function(popup) { popup.classList.remove("is-open"); });
  });
}
function restoreMemoCard() {
  if (els.memoCard.parentElement !== els.sideColumn) els.sideColumn.append(els.memoCard);
}
function placeWeekMemoCard() {
  const grid = els.weekView.querySelector(".week-grid");
  if (!grid) return;
  const fourthCard = grid.children[3];
  if (fourthCard) grid.insertBefore(els.memoCard, fourthCard);
  else grid.append(els.memoCard);
}

function render() {
  els.shell.classList.toggle("is-month-view", state.view === "month");
  els.shell.classList.toggle("is-day-view", state.view === "day");
  els.shell.classList.toggle("is-week-view", state.view === "week");
  if (state.view !== "week") restoreMemoCard();
  document.querySelectorAll(".view-button").forEach(function(button) {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  els.monthView.hidden = state.view !== "month";
  els.weekView.hidden = state.view !== "week";
  els.dayView.hidden = state.view !== "day";
  els.todoCardTitle.textContent = state.view === "month" ? "월간 일정" : state.view === "week" ? "주간 일정" : "일간 체크리스트";
  renderHeading();
  if (state.view === "month") renderMonth();
  if (state.view === "week") { renderWeek(); placeWeekMemoCard(); }
  if (state.view === "day") renderDay();
  renderSelectedDay();
  saveState();
}
function renderHeading() {
  const date = fromIso(state.focusDate);
  if (state.view === "month") {
    els.periodTitle.textContent = date.getFullYear() + "년 " + (date.getMonth() + 1) + "월";
    els.focusDateLabel.textContent = dateLabel(state.focusDate);
  } else if (state.view === "week") {
    const start = startOfWeek(date);
    const end = addDays(start, 6);
    els.periodTitle.textContent = (start.getMonth() + 1) + "월 " + start.getDate() + "일 – " + (end.getMonth() + 1) + "월 " + end.getDate() + "일";
    els.focusDateLabel.textContent = "선택 날짜 · " + dateLabel(state.focusDate);
  } else {
    els.periodTitle.textContent = dateLabel(state.focusDate, true);
    els.focusDateLabel.textContent = "";
  }
}

function renderMonth() {
  const date = fromIso(state.focusDate);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const card = document.createElement("section");
  card.className = "calendar-card";
  const weekdays = document.createElement("div");
  weekdays.className = "weekday-row";
  WEEKDAYS.forEach(function(day) { const item = document.createElement("span"); item.textContent = day; weekdays.append(item); });
  card.append(weekdays);
  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  for (let index = 0; index < 35; index += 1) {
    const cellDate = addDays(first, index - offset);
    const key = isoDate(cellDate);
    const day = getDay(key);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-cell";
    cell.dataset.date = key;
    if (cellDate.getMonth() !== date.getMonth()) cell.classList.add("is-other");
    if (key === state.focusDate) cell.classList.add("is-selected");
    if (key === isoDate(new Date())) cell.classList.add("is-today");
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = cellDate.getDate();
    cell.append(number);
    if (dailyGoalReached(key)) {
      cell.classList.add("has-goal-stamp");
      const stamp = document.createElement("img");
      stamp.className = "goal-stamp";
      stamp.src = "./도장.png";
      stamp.alt = "하루 목표 달성";
      cell.append(stamp);
    }
    const meta = document.createElement("span");
    meta.className = "cell-meta";
    const studyTotal = totalMinutes(studyFromTimeBlocks(day));
    if (studyTotal) {
      const study = document.createElement("strong");
      study.textContent = shortDuration(studyTotal);
      meta.append(study);
    }
    if (day.schedules.length) {
      const preview = document.createElement("span");
      preview.className = "schedule-preview";
      day.schedules.slice(0, 3).forEach(function(schedule) {
        const item = document.createElement("span");
        item.className = "schedule-preview-item";
        item.textContent = schedule.text;
        preview.append(item);
      });
      if (day.schedules.length > 3) {
        const more = document.createElement("span");
        more.className = "schedule-more";
        more.textContent = "+" + (day.schedules.length - 3);
        preview.append(more);
      }
      meta.append(preview);
    }
    cell.append(meta);
    const stamp = cell.querySelector(".goal-stamp");
    if (stamp) cell.append(stamp);
    grid.append(cell);
  }
  card.append(grid);
  els.monthView.replaceChildren(card);
}
function renderWeek() {
  const grid = document.createElement("div");
  grid.className = "week-grid";
  const start = startOfWeek(fromIso(state.focusDate));
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    const key = isoDate(date);
    const day = getDay(key);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "week-card";
    card.dataset.date = key;
    if (key === state.focusDate) card.classList.add("is-selected");
    const header = document.createElement("header");
    const title = document.createElement("h3"); title.textContent = WEEKDAYS[index];
    const number = document.createElement("span"); number.className = "week-date"; number.textContent = (date.getMonth() + 1) + "/" + date.getDate();
    header.append(title, number);
    card.append(header);
    const total = document.createElement("strong"); total.className = "week-total"; total.textContent = durationLabel(totalMinutes(studyFromTimeBlocks(day))); card.append(total);
    const count = document.createElement("p"); count.textContent = "일정 " + day.schedules.filter(function(item) { return !item.done; }).length + "개 남음"; card.append(count);
    const dots = document.createElement("div"); dots.className = "subject-dots";
    Object.keys(studyFromTimeBlocks(day)).forEach(function(subject) { const dot = document.createElement("span"); dot.className = "subject-dot"; dot.style.background = SUBJECTS[subject]?.color || SUBJECTS.etc.color; dots.append(dot); });
    card.append(dots);
    grid.append(card);
  }
  const goalPanel = document.createElement("section");
  goalPanel.className = "week-goal-panel";
  const goalHeading = document.createElement("div");
  goalHeading.className = "week-goal-heading";
  const goalTitle = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "card-kicker";
  kicker.textContent = "WEEK GOAL";
  const heading = document.createElement("h3");
  heading.textContent = "일주일 목표";
  goalTitle.append(kicker, heading);
  const goalInputWrap = document.createElement("label");
  goalInputWrap.className = "week-goal-input";
  const goalInput = document.createElement("input");
  goalInput.type = "number";
  goalInput.min = "0";
  goalInput.max = "168";
  goalInput.step = "0.5";
  goalInput.placeholder = "0";
  goalInput.value = state.weekGoals[isoDate(start)] ? String(state.weekGoals[isoDate(start)] / 60) : "";
  goalInput.setAttribute("aria-label", "일주일 목표 시간");
  const goalUnit = document.createElement("span");
  goalUnit.textContent = "시간";
  goalInputWrap.append(goalInput, goalUnit);
  goalHeading.append(goalTitle, goalInputWrap);
  const goalTotal = totalMinutes(periodStudy());
  const goalMinutes = Number(state.weekGoals[isoDate(start)] || 0);
  const progress = goalMinutes > 0 ? Math.min(100, goalTotal / goalMinutes * 100) : 0;
  const progressText = document.createElement("div");
  progressText.className = "week-goal-progress-text";
  progressText.textContent = goalMinutes > 0 ? shortDuration(goalTotal) + " / " + shortDuration(goalMinutes) : "목표 시간을 입력해 주세요";
  const progressTrack = document.createElement("div");
  progressTrack.className = "week-goal-track";
  const progressBar = document.createElement("span");
  progressBar.className = "week-goal-bar";
  progressBar.style.width = progress + "%";
  progressTrack.append(progressBar);
  goalPanel.append(goalHeading, progressText, progressTrack);
  goalInput.addEventListener("change", function() {
    const hours = Number(goalInput.value);
    if (Number.isFinite(hours) && hours > 0) state.weekGoals[isoDate(start)] = Math.round(hours * 60);
    else delete state.weekGoals[isoDate(start)];
    saveState();
    renderWeek();
  });
  els.weekView.replaceChildren(grid, goalPanel);
}

function renderWeek() {
  const grid = document.createElement("div");
  grid.className = "week-grid";
  const start = startOfWeek(fromIso(state.focusDate));
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    const key = isoDate(date);
    const day = getDay(key);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "week-card";
    card.dataset.date = key;
    if (key === state.focusDate) card.classList.add("is-selected");
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = WEEKDAYS[index];
    const number = document.createElement("span");
    number.className = "week-date";
    number.textContent = (date.getMonth() + 1) + "/" + date.getDate();
    header.append(title, number);
    card.append(header);
    if (dailyGoalReached(key)) {
      card.classList.add("has-goal-stamp");
      const stamp = document.createElement("img");
      stamp.className = "goal-stamp";
      stamp.src = "./도장.png";
      stamp.alt = "하루 목표 달성";
      card.append(stamp);
    }
    const total = document.createElement("strong");
    total.className = "week-total";
    total.textContent = durationLabel(totalMinutes(studyFromTimeBlocks(day)));
    card.append(total);
    const count = document.createElement("p");
    count.textContent = "\uc77c\uc815 " + day.schedules.filter(function(item) { return !item.done; }).length + "\uac1c \ub0a8\uc74c";
    card.append(count);
    if (day.schedules.length) {
      const scheduleList = document.createElement("div");
      scheduleList.className = "week-schedule-list";
      day.schedules.slice(0, 3).forEach(function(schedule) {
        const scheduleItem = document.createElement("span");
        scheduleItem.className = "week-schedule-item";
        if (schedule.done) scheduleItem.classList.add("is-done");
        scheduleItem.textContent = schedule.text;
        scheduleList.append(scheduleItem);
      });
      if (day.schedules.length > 3) {
        const more = document.createElement("span");
        more.className = "week-schedule-more";
        more.textContent = "+" + (day.schedules.length - 3);
        scheduleList.append(more);
      }
      card.append(scheduleList);
    }
    const dots = document.createElement("div");
    dots.className = "subject-dots";
    Object.keys(studyFromTimeBlocks(day)).forEach(function(subject) {
      const dot = document.createElement("span");
      dot.className = "subject-dot";
      dot.style.background = SUBJECTS[subject]?.color || SUBJECTS.etc.color;
      dots.append(dot);
    });
    card.append(dots);
    const stamp = card.querySelector(".goal-stamp");
    if (stamp) card.append(stamp);
    else {
      const stampPlaceholder = document.createElement("span");
      stampPlaceholder.className = "goal-stamp-placeholder";
      stampPlaceholder.setAttribute("aria-hidden", "true");
      card.append(stampPlaceholder);
    }
    grid.append(card);
  }
  const goalPanel = document.createElement("section");
  goalPanel.className = "week-goal-panel";
  const goalHeading = document.createElement("div");
  goalHeading.className = "week-goal-heading";
  const goalTitle = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "card-kicker";
  kicker.textContent = "WEEK GOAL";
  const heading = document.createElement("h3");
  heading.textContent = "\uc77c\uc8fc\uc77c \ubaa9\ud45c";
  goalTitle.append(kicker, heading);
  const goalInputs = document.createElement("div");
  goalInputs.className = "week-goal-inputs";
  function makeGoalInput(key, labelText) {
    const wrap = document.createElement("label");
    wrap.className = "week-goal-input";
    const label = document.createElement("span");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "24";
    input.step = "0.5";
    input.placeholder = "0";
    input.value = state.dailyGoals[key] ? String(state.dailyGoals[key] / 60) : "";
    input.setAttribute("aria-label", labelText + " \uc2dc\uac04");
    const unit = document.createElement("span");
    unit.textContent = "\uc2dc\uac04";
    wrap.append(label, input, unit);
    input.addEventListener("change", function() {
      const hours = Number(input.value);
      state.dailyGoals[key] = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0;
      saveState();
      renderWeek();
    });
    return wrap;
  }
  goalInputs.append(makeGoalInput("weekday", "\ud3c9\uc77c"), makeGoalInput("weekend", "\uc8fc\ub9d0"));
  goalHeading.append(goalTitle, goalInputs);
  const goalTotal = totalMinutes(periodStudy());
  const weekdayGoal = Number(state.dailyGoals.weekday || 0);
  const weekendGoal = Number(state.dailyGoals.weekend || 0);
  const goalMinutes = weekdayGoal * 5 + weekendGoal * 2;
  const progress = goalMinutes > 0 ? Math.max(0, goalTotal / goalMinutes * 100) : 0;
  const progressText = document.createElement("div");
  progressText.className = "week-goal-progress-text";
  progressText.textContent = goalMinutes > 0 ? shortDuration(goalTotal) + " / " + shortDuration(goalMinutes) + " (" + Math.round(progress) + "%)" : "\ud3c9\uc77c\u00b7\uc8fc\ub9d0 \ubaa9\ud45c \uc2dc\uac04\uc744 \uc785\ub825\ud574 \uc8fc\uc138\uc694";
  const progressTrack = document.createElement("div");
  progressTrack.className = "week-goal-track";
  const progressBar = document.createElement("span");
  progressBar.className = "week-goal-bar";
  progressBar.style.width = Math.min(200, progress) + "%";
  progressTrack.append(progressBar);
  goalPanel.append(goalHeading, progressText, progressTrack);
  els.weekView.replaceChildren(grid, goalPanel);
}

function renderDay() {
  const day = getDay(state.focusDate);
  const card = document.createElement("section");
  card.className = "day-card";
  const controls = document.createElement("div");
  controls.className = "day-time-controls";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "clear-time-button";
  undo.textContent = "↶";
  undo.setAttribute("aria-label", "마지막 표시 취소");
  undo.title = "마지막 표시 취소";
  undo.disabled = !day.timeBlocks.length;
  undo.addEventListener("click", function() {
    const removed = day.timeBlocks.pop();
    if (!removed) return;
    day.timeBlockRedo.push(removed);
    saveState();
    render();
  });
  const redo = document.createElement("button");
  redo.type = "button";
  redo.className = "clear-time-button";
  redo.textContent = "↷";
  redo.setAttribute("aria-label", "취소한 표시 다시 실행");
  redo.title = "취소한 표시 다시 실행";
  redo.disabled = !day.timeBlockRedo.length;
  redo.addEventListener("click", function() {
    const restored = day.timeBlockRedo.pop();
    if (!restored) return;
    day.timeBlocks.push(restored);
    saveState();
    render();
  });
  const historyControls = document.createElement("div");
  historyControls.className = "time-history-controls";
  historyControls.append(undo, redo);
  controls.append(historyControls);
  const timeGrid = document.createElement("div");
  timeGrid.className = "time-grid";
  for (let row = 0; row <= 24; row += 1) {
    const line = document.createElement("div");
    line.className = "time-grid-row";
    const label = document.createElement("span");
    label.className = "time-range";
    label.textContent = String(row).padStart(2, "0") + ":00";
    line.append(label);
    const slots = document.createElement("div");
    slots.className = "slot-grid";
    for (let column = 0; column < 6; column += 1) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "time-slot";
      slot.tabIndex = -1;
      slots.append(slot);
    }
    line.append(slots);
    timeGrid.append(line);
  }
  card.append(controls, timeGrid);
  els.dayView.replaceChildren(card);
  const grids = Array.from(timeGrid.querySelectorAll(".slot-grid"));
  const first = grids[0];
  const last = grids[24];
  const surface = document.createElement("div");
  surface.className = "drawing-surface";
  // Convert the transformed screen rectangles back into the time grid's
  // local coordinates so the drawing surface stays aligned on every scale.
  const gridRect = timeGrid.getBoundingClientRect();
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  const localScale = first.offsetWidth ? firstRect.width / first.offsetWidth : 1;
  surface.style.left = ((firstRect.left - gridRect.left) / localScale) + "px";
  surface.style.top = ((firstRect.top - gridRect.top) / localScale) + "px";
  surface.style.width = (firstRect.width / localScale) + "px";
  surface.style.height = ((lastRect.bottom - firstRect.top) / localScale) + "px";
  timeGrid.append(surface);
  day.timeBlocks.forEach(function(block) { renderTimeBlock(surface, block); });
  enablePainting(surface);
}
function formatTime(minutes) {
  const safe = Math.max(0, Math.min(1500, Math.round(minutes)));
  if (safe === 1440) return "24:00";
  if (safe > 1440) {
    const next = safe - 1440;
    return "다음날 " + String(Math.floor(next / 60)).padStart(2, "0") + ":" + String(next % 60).padStart(2, "0");
  }
  return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
}
function minuteFromPointer(event, surface) {
  const rect = surface.getBoundingClientRect();
  const vertical = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  const horizontal = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const hour = Math.min(24, Math.floor(vertical * 25));
  const minute = Math.round((horizontal * 60) / DRAG_MINUTE_UNIT) * DRAG_MINUTE_UNIT;
  return Math.min(1500, hour * 60 + minute);
}
function renderTimeBlock(surface, block, className) {
  const cssClass = className || "time-highlight";
  const ranges = [];
  const firstHour = Math.floor(block.start / 60);
  const lastHour = Math.ceil(block.end / 60);
  for (let hour = firstHour; hour < lastHour; hour += 1) {
    const start = Math.max(block.start, hour * 60);
    const end = Math.min(block.end, hour * 60 + 60);
    if (end <= start) continue;
    const item = document.createElement("div");
    item.className = cssClass;
    item.dataset.blockId = block.id || "preview";
    item.dataset.source = block.source || "manual";
    item.style.top = (hour / 25 * 100) + "%";
    item.style.height = (100 / 25) + "%";
    item.style.left = ((start - hour * 60) / 60 * 100) + "%";
    item.style.width = ((end - start) / 60 * 100) + "%";
    item.style.background = SUBJECTS[block.subject]?.color || SUBJECTS.etc.color;
    item.title = formatTime(block.start) + "–" + formatTime(block.end);
    surface.append(item);
    ranges.push({ item: item, minutes: end - start });
  }
  if (ranges.length) {
    const startHandle = document.createElement("span");
    startHandle.className = "time-resize-handle";
    startHandle.dataset.resizeEdge = "start";
    ranges[0].item.append(startHandle);
    const endHandle = document.createElement("span");
    endHandle.className = "time-resize-handle";
    endHandle.dataset.resizeEdge = "end";
    ranges[ranges.length - 1].item.append(endHandle);
  }
  if (block.todoText && ranges.length) {
    const target = ranges.find(function(range) { return range.minutes >= 15; }) || ranges[0];
    const label = document.createElement("span");
    label.className = "time-highlight-label";
    label.textContent = block.todoText;
    target.item.append(label);
  }
  return ranges.map(function(range) { return range.item; });
}
function syncTimeBlockTodoText(day, todoIndex, text) {
  const nextText = String(text || "").trim();
  day.timeBlocks.forEach(function(block) {
    if (block.todoIndex === null || block.todoIndex === undefined || Number(block.todoIndex) !== Number(todoIndex)) return;
    block.todoText = nextText;
    const labels = els.dayView.querySelectorAll('.time-highlight[data-block-id="' + block.id + '"] .time-highlight-label');
    labels.forEach(function(label) { label.textContent = nextText; });
  });
}
function timeBlockOverlaps(day, start, end, excludedId) {
  return day.timeBlocks.some(function(block) {
    if (excludedId && String(block.id) === String(excludedId)) return false;
    return start < Number(block.end) && end > Number(block.start);
  });
}
function checklistCandidates(day, subject) {
  return day.todos.map(function(todo, index) { return { todo: todo, index: index }; }).filter(function(entry) {
    return entry.todo.subject === subject && entry.todo.text && entry.todo.text.trim();
  });
}
function renderPreview(surface, block, blocked) {
  return renderTimeBlock(surface, block, "time-highlight is-drawing" + (blocked ? " is-invalid" : ""));
}
function enablePainting(surface) {
  let start = null;
  let preview = [];
  let painting = false;
  let resizing = null;
  let resizePreview = [];
  function removeBlockElements(blockId) {
    Array.from(surface.querySelectorAll(".time-highlight")).forEach(function(item) {
      if (String(item.dataset.blockId) === String(blockId)) item.remove();
    });
  }
  function update(event) {
    const current = minuteFromPointer(event, surface);
    const from = Math.min(start, current);
    const to = Math.max(start, current);
    const blocked = timeBlockOverlaps(getDay(state.focusDate), from, to);
    preview.forEach(function(item) { item.remove(); });
    preview = renderPreview(surface, { start: from, end: to, subject: els.subjectSelect.value }, blocked);
  }
  function updateResize(event) {
    if (!resizing) return;
    const day = getDay(state.focusDate);
    const block = day.timeBlocks.find(function(item) { return String(item.id) === String(resizing.blockId); });
    if (!block) return;
    const current = minuteFromPointer(event, surface);
    let from = resizing.originalStart;
    let to = resizing.originalEnd;
    if (resizing.edge === "start") from = Math.max(0, Math.min(current, to - DRAG_MINUTE_UNIT));
    else to = Math.min(1500, Math.max(current, from + DRAG_MINUTE_UNIT));
    const blocked = timeBlockOverlaps(day, from, to, block.id);
    removeBlockElements(block.id);
    resizePreview.forEach(function(item) { item.remove(); });
    resizePreview = renderPreview(surface, { id: block.id, start: from, end: to, subject: block.subject, todoText: block.todoText }, blocked);
    resizing.nextStart = from;
    resizing.nextEnd = to;
    resizing.blocked = blocked;
  }
  function finishResize(event) {
    if (!resizing) return;
    updateResize(event);
    const current = resizing;
    resizing = null;
    resizePreview.forEach(function(item) { item.remove(); });
    resizePreview = [];
    const day = getDay(state.focusDate);
    const block = day.timeBlocks.find(function(item) { return String(item.id) === String(current.blockId); });
    if (!block || current.blocked || current.nextEnd <= current.nextStart) { renderDay(); return; }
    block.start = current.nextStart;
    block.end = current.nextEnd;
    day.timeBlockRedo = [];
    saveState();
    render();
  }
  function finish(event) {
    if (!painting || start === null) return;
    const current = minuteFromPointer(event, surface);
    const from = Math.min(start, current);
    const to = Math.max(start, current);
    preview.forEach(function(item) { item.remove(); });
    preview = [];
    painting = false;
    start = null;
    const day = getDay(state.focusDate);
    const subject = els.subjectSelect.value;
    if (timeBlockOverlaps(day, from, to) || to <= from) { renderDay(); return; }
    const candidates = checklistCandidates(day, subject);
    if (!candidates.length) {
      window.alert((SUBJECTS[subject]?.label || "선택한 과목") + " 체크리스트를 먼저 등록해 주세요.");
      renderDay();
      return;
    }
    openTimeBlockDialog({ start: from, end: to, subject: subject }, candidates);
  }
  surface.addEventListener("pointerdown", function(event) {
    if (event.button !== 0) return;
    const existing = event.target.closest(".time-highlight");
    if (existing) {
      const day = getDay(state.focusDate);
      const block = day.timeBlocks.find(function(item) { return String(item.id) === existing.dataset.blockId; });
      const handle = event.target.closest(".time-resize-handle");
      if (block && handle) {
        event.preventDefault();
        resizing = { blockId: block.id, edge: handle.dataset.resizeEdge, originalStart: Number(block.start), originalEnd: Number(block.end), nextStart: Number(block.start), nextEnd: Number(block.end), blocked: false };
        surface.setPointerCapture(event.pointerId);
        updateResize(event);
        return;
      }
      if (block) openTimeBlockDialog({ start: block.start, end: block.end, subject: block.subject, existingId: block.id }, checklistCandidates(day, block.subject));
      return;
    }
    const subject = els.subjectSelect.value;
    if (!checklistCandidates(getDay(state.focusDate), subject).length) {
      window.alert((SUBJECTS[subject]?.label || "선택한 과목") + " 체크리스트를 먼저 등록해 주세요.");
      return;
    }
    event.preventDefault();
    start = minuteFromPointer(event, surface);
    painting = true;
    surface.setPointerCapture(event.pointerId);
    update(event);
  });
  surface.addEventListener("pointermove", function(event) { if (resizing) updateResize(event); else if (painting) update(event); });
  surface.addEventListener("pointerup", function(event) { if (resizing) finishResize(event); else finish(event); });
  surface.addEventListener("pointercancel", function() {
    if (resizing) {
      resizing = null;
      resizePreview.forEach(function(item) { item.remove(); });
      resizePreview = [];
      renderDay();
      return;
    }
    preview.forEach(function(item) { item.remove(); }); preview = []; painting = false; start = null;
  });
}

function renderPeriodScheduleList() {
  els.todoList.replaceChildren();
  const schedules = periodDateKeys().flatMap(function(key) {
    return getDay(key).schedules.map(function(schedule) { return Object.assign({}, schedule, { date: key }); });
  });
  if (!schedules.length) {
    const empty = document.createElement("li");
    empty.className = "schedule-empty";
    empty.textContent = "달력에서 날짜를 눌러 일정을 추가해 보세요.";
    els.todoList.append(empty);
    return;
  }
  const visibleLimit = state.view === "month" ? 5 : 3;
  schedules.slice(0, visibleLimit).forEach(function(schedule) {
    const item = document.createElement("li"); item.className = "schedule-preview-row";
    const check = document.createElement("input"); check.className = "schedule-check"; check.type = "checkbox"; check.checked = Boolean(schedule.done); check.dataset.scheduleDate = schedule.date; check.dataset.scheduleId = schedule.id;
    const content = document.createElement("span"); content.className = "schedule-preview-content";
    const text = document.createElement("span"); text.textContent = schedule.text;
    const date = document.createElement("small"); date.textContent = dateLabel(schedule.date).replace(/ \\(.+\\)$/, "");
    content.append(text, date);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "schedule-delete"; remove.textContent = "×"; remove.dataset.scheduleDate = schedule.date; remove.dataset.scheduleId = schedule.id; remove.setAttribute("aria-label", schedule.text + " 일정 삭제");
    if (schedule.done) item.classList.add("is-done");
    item.append(check, content, remove);
    els.todoList.append(item);
  });
  if (schedules.length > visibleLimit) {
    const more = document.createElement("li");
    more.className = "schedule-period-more";
    more.textContent = "+" + (schedules.length - visibleLimit);
    els.todoList.append(more);
  }
}
function renderTodoEditor(day) {
  els.todoList.replaceChildren();
  for (let index = 0; index < 15; index += 1) {
    const row = document.createElement("li"); row.className = "checklist-row";
    const number = document.createElement("span"); number.className = "checklist-number"; number.textContent = index + 1;
    const content = document.createElement("div"); content.className = "checklist-content";
    const input = document.createElement("input"); input.className = "checklist-input"; input.type = "text"; input.maxLength = 80; input.value = day.todos[index]?.text || ""; input.dataset.index = index;
    const subject = document.createElement("select"); subject.className = "checklist-subject"; subject.dataset.index = index;
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "과목"; subject.append(empty);
    SUBJECT_KEYS.forEach(function(key) { const option = document.createElement("option"); option.value = key; option.textContent = "(" + SUBJECTS[key].label + ")"; subject.append(option); });
    subject.value = day.todos[index]?.subject || "";
    const done = document.createElement("input"); done.className = "checklist-check"; done.type = "checkbox"; done.checked = Boolean(day.todos[index]?.done); done.dataset.index = index;
    content.append(input, subject, done); row.append(number, content); els.todoList.append(row);
  }
}
function renderDayScheduleList(day) {
  els.dayScheduleDateLabel.textContent = dateLabel(state.focusDate);
  els.dayScheduleList.replaceChildren();
  if (!day.schedules.length) {
    const empty = document.createElement("li"); empty.className = "schedule-empty"; empty.textContent = "등록된 일정이 없습니다."; els.dayScheduleList.append(empty); return;
  }
  day.schedules.forEach(function(schedule) { const item = document.createElement("li"); item.className = "day-schedule-row"; if (schedule.done) item.classList.add("is-done"); item.textContent = schedule.text; els.dayScheduleList.append(item); });
}
function renderSelectedDay() {
  const day = getDay(state.focusDate);
  const study = state.view === "day" ? studyFromTimeBlocks(day) : periodStudy();
  const total = totalMinutes(study);
  const label = dateLabel(state.focusDate);
  els.todoDateLabel.textContent = state.view === "day" ? label : "";
  els.studyDateLabel.textContent = state.view === "day" ? label : "";
  els.memoInput.value = currentMemo();
  els.feedbackInput.value = day.feedback;
  refreshPlannerInkEditors();
  els.dailyTotalStudy.textContent = durationLabel(total);
  els.studyTotal.textContent = shortDuration(total);
  els.studyPeriodLabel.textContent = studyLabel();
  if (state.view === "day") renderTodoEditor(day); else renderPeriodScheduleList();
  renderDayScheduleList(day);
  const entries = Object.entries(study).filter(function(entry) { return entry[1] > 0; });
  if (!entries.length) { els.studyPie.style.background = "#e9e2d8"; els.studyLegend.innerHTML = "<p class=\"empty-message\">공부 기록이 없습니다.</p>"; return; }
  let cursor = 0;
  const segments = entries.map(function(entry) { const start = cursor; cursor += entry[1] / total * 100; return (SUBJECTS[entry[0]]?.color || SUBJECTS.etc.color) + " " + start + "% " + cursor + "%"; });
  els.studyPie.style.background = "conic-gradient(" + segments.join(", ") + ")";
  els.studyLegend.replaceChildren();
  entries.forEach(function(entry) { const row = document.createElement("div"); row.className = "legend-item"; const dot = document.createElement("span"); dot.className = "legend-color"; dot.style.background = SUBJECTS[entry[0]]?.color || SUBJECTS.etc.color; const name = document.createElement("span"); name.textContent = SUBJECTS[entry[0]]?.label || entry[0]; const value = document.createElement("strong"); value.textContent = state.view === "day" ? entry[1] + "분" : durationLabel(entry[1]); row.append(dot, name, value); els.studyLegend.append(row); });
}

function shiftPeriod(amount) {
  const date = fromIso(state.focusDate);
  if (state.view === "month") date.setMonth(date.getMonth() + amount, 1);
  else if (state.view === "week") date.setDate(date.getDate() + amount * 7);
  else date.setDate(date.getDate() + amount);
  state.focusDate = isoDate(date);
  render();
}
function openScheduleDialog() {
  els.scheduleDialogDate.textContent = dateLabel(state.scheduleEditingDate, true);
  els.scheduleInput.value = "";
  els.scheduleDialog.showModal();
  els.scheduleInput.focus();
}
function closeScheduleDialog() { if (els.scheduleDialog.open) els.scheduleDialog.close(); }
function closeTimeBlockDialog() { if (els.timeBlockDialog.open) els.timeBlockDialog.close(); pendingTimeBlock = null; }
function openTimeBlockDialog(block, candidates) {
  if (!candidates.length) { window.alert("선택한 시간의 체크리스트가 없습니다."); return; }
  pendingTimeBlock = Object.assign({}, block, { candidates: candidates });
  els.timeBlockRange.textContent = formatTime(block.start) + " – " + formatTime(block.end) + " · " + (SUBJECTS[block.subject]?.label || "기타");
  els.timeBlockTodoSelect.replaceChildren();
  candidates.forEach(function(entry) { const option = document.createElement("option"); option.value = entry.index; option.textContent = (entry.index + 1) + "번 · " + entry.todo.text.trim(); els.timeBlockTodoSelect.append(option); });
  els.timeBlockDialog.showModal();
  els.timeBlockTodoSelect.focus();
}

document.querySelectorAll(".view-button").forEach(function(button) { button.addEventListener("click", function() { state.view = button.dataset.view; render(); }); });
els.previousPeriod.addEventListener("click", function() { shiftPeriod(-1); });
els.nextPeriod.addEventListener("click", function() { shiftPeriod(1); });
els.todayButton.addEventListener("click", function() { state.focusDate = isoDate(new Date()); render(); });
document.addEventListener("click", function(event) {
  const target = event.target.closest("[data-date]");
  if (!target) return;
  state.focusDate = target.dataset.date;
  if (state.view === "month" || state.view === "week") { state.scheduleEditingDate = target.dataset.date; render(); openScheduleDialog(); }
  else render();
});
els.scheduleCancel.addEventListener("click", closeScheduleDialog);
els.scheduleDialog.addEventListener("click", function(event) { if (event.target === els.scheduleDialog) closeScheduleDialog(); });
els.scheduleForm.addEventListener("submit", function(event) {
  event.preventDefault();
  const text = els.scheduleInput.value.trim();
  if (!text || !state.scheduleEditingDate) return;
  getDay(state.scheduleEditingDate).schedules.push({ id: makeId(), text: text, done: false });
  closeScheduleDialog();
  render();
});
els.timeBlockCancel.addEventListener("click", closeTimeBlockDialog);
els.timeBlockDialog.addEventListener("click", function(event) { if (event.target === els.timeBlockDialog) closeTimeBlockDialog(); });
els.timeBlockForm.addEventListener("submit", function(event) {
  event.preventDefault();
  if (!pendingTimeBlock) return;
  const todoIndex = Number(els.timeBlockTodoSelect.value);
  const selected = pendingTimeBlock.candidates.find(function(entry) { return entry.index === todoIndex; });
  const day = getDay(state.focusDate);
  if (pendingTimeBlock.existingId) {
    const block = day.timeBlocks.find(function(item) { return String(item.id) === String(pendingTimeBlock.existingId); });
    if (block) {
      block.todoIndex = todoIndex;
      block.todoText = selected?.todo.text.trim() || "";
      day.timeBlockRedo = [];
    }
  } else {
    day.timeBlocks.push({ id: makeId(), start: pendingTimeBlock.start, end: pendingTimeBlock.end, subject: pendingTimeBlock.subject, todoIndex: todoIndex, todoText: selected?.todo.text.trim() || "", source: "manual" });
    day.timeBlockRedo = [];
  }
  closeTimeBlockDialog();
  render();
});
els.todoList.addEventListener("input", function(event) {
  if (!event.target.matches(".checklist-input")) return;
  const index = Number(event.target.dataset.index);
  const day = getDay(state.focusDate);
  const todo = day.todos[index] || { id: makeId(), text: "", subject: "", done: false };
  todo.text = event.target.value;
  day.todos[index] = todo;
  syncTimeBlockTodoText(day, index, todo.text);
  saveState();
});
els.todoList.addEventListener("change", function(event) {
  if (event.target.matches(".schedule-check")) {
    const day = getDay(event.target.dataset.scheduleDate);
    const schedule = day.schedules.find(function(item) { return String(item.id) === event.target.dataset.scheduleId; });
    if (schedule) schedule.done = event.target.checked;
    saveState();
    renderPeriodScheduleList();
    return;
  }
  if (!event.target.matches(".checklist-subject, .checklist-check")) return;
  const index = Number(event.target.dataset.index);
  const day = getDay(state.focusDate);
  const todo = day.todos[index] || { id: makeId(), text: "", subject: "", done: false };
  if (event.target.matches(".checklist-subject")) { todo.subject = event.target.value; if (todo.subject) els.subjectSelect.value = todo.subject; }
  else todo.done = event.target.checked;
  day.todos[index] = todo;
  saveState();
});
els.todoList.addEventListener("click", function(event) {
  const button = event.target.closest(".schedule-delete");
  if (!button) return;
  const day = getDay(button.dataset.scheduleDate);
  day.schedules = day.schedules.filter(function(item) { return String(item.id) !== button.dataset.scheduleId; });
  saveState();
  render();
});
els.memoInput.addEventListener("input", function() { saveCurrentMemo(els.memoInput.value); });
els.feedbackInput.addEventListener("input", function() { getDay(state.focusDate).feedback = els.feedbackInput.value; saveState(); });

window.addPlannerTimeBlock = function(data) {
  const day = getDay(data.date);
  day.timeBlocks.push({ id: makeId(), start: Number(data.start), end: Number(data.end), subject: data.subject, source: data.source || "timer", todoIndex: data.todoIndex ?? null, todoText: data.todoText || "" });
  day.timeBlockRedo = [];
  saveState();
  if (state.view === "day" && state.focusDate === data.date) render();
};

setupPlannerInkEditors();
render();

let plannerResizeTimer = 0;
window.addEventListener("resize", function() {
  plannerInkEditors.forEach(function(editorState) {
    if (editorState.mode === "ink") window.requestAnimationFrame(function() { resizePlannerInk(editorState); });
  });
  window.clearTimeout(plannerResizeTimer);
  plannerResizeTimer = window.setTimeout(function() {
    if (state.view === "day") render();
  }, 80);
});
