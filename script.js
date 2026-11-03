const timeInputs = {
  hours: document.querySelector("#hours"),
  minutes: document.querySelector("#minutes"),
};

const els = {
  toggleButton: document.querySelector("#toggleButton"),
  toggleLabel: document.querySelector("#toggleLabel"),
  resetButton: document.querySelector("#resetButton"),
  settingsButton: document.querySelector("#settingsButton"),
  miniTimerButton: document.querySelector("#miniTimerButton"),
  miniTimersLayer: document.querySelector("#miniTimersLayer"),
  quickPresets: document.querySelector("#quickPresets"),
  quickPresetList: document.querySelector("#quickPresetList"),
  saveQuickPreset: document.querySelector("#saveQuickPreset"),
  settingsPanel: document.querySelector("#settingsPanel"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  closeSettings: document.querySelector("#closeSettings"),
  saveSettings: document.querySelector("#saveSettings"),
  modeBadge: document.querySelector("#modeBadge"),
  modeName: document.querySelector("#modeName"),
  dailyAccumulation: document.querySelector("#dailyAccumulation"),
  mockSubjectLabel: document.querySelector("#mockSubjectLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  secondsHint: document.querySelector("#secondsHint"),
  secondsDisplay: document.querySelector("#secondsDisplay"),
  statusText: document.querySelector("#statusText"),
  pomodoroOptions: document.querySelector("#pomodoroOptions"),
  mockOptions: document.querySelector("#mockOptions"),
  timerSubject: document.querySelector("#timerSubject"),
  timerSubjectControl: document.querySelector("#timerSubjectControl"),
  timerSubjectDisplay: document.querySelector("#timerSubjectDisplay"),
  roundCount: document.querySelector("#roundCount"),
  examSubject: document.querySelector("#examSubject"),
  mascotWrap: document.querySelector(".mascot-wrap"),
  mascot: document.querySelector("#mascot"),
};

const EXAM_SLOTS = {
  korean: { name: "국어", seconds: 80 * 60 },
  math: { name: "수학", seconds: 100 * 60 },
  english: { name: "영어", seconds: 70 * 60 },
  history: { name: "한국사", seconds: 30 * 60 },
  social: { name: "사회탐구", seconds: 40 * 60 },
  science: { name: "과학탐구", seconds: 40 * 60 },
};

const MOCK_DAY_SCHEDULE = [
  { name: "국어", seconds: 80 * 60, type: "exam" },
  { name: "쉬는 시간", seconds: 30 * 60, type: "break" },
  { name: "수학", seconds: 100 * 60, type: "exam" },
  { name: "점심시간", seconds: 60 * 60, type: "break" },
  { name: "영어", seconds: 70 * 60, type: "exam" },
  { name: "쉬는 시간", seconds: 30 * 60, type: "break" },
  { name: "한국사", seconds: 30 * 60, type: "exam" },
  { name: "쉬는 시간", seconds: 15 * 60, type: "break" },
  { name: "사회탐구", seconds: 40 * 60, type: "exam" },
  { name: "쉬는 시간", seconds: 15 * 60, type: "break" },
  { name: "과학탐구", seconds: 40 * 60, type: "exam" },
];

const MODE_NAMES = { normal: "일반 모드", pomodoro: "뽀모도로 모드", mock: "모의고사 모드" };

const state = {
  mode: "normal",
  sound: "mute",
  running: false,
  currentSeconds: 0,
  initialSeconds: 0,
  segmentSeconds: 0,
  startedAt: null,
  timerId: null,
  alarmId: null,
  audioContext: null,
  alarmUntil: null,
  phase: "work",
  round: 1,
  totalRounds: 1,
  examSubject: "korean",
  subject: "",
  scheduleIndex: 0,
  stopwatch: false,
  stopwatchElapsed: 0,
  dailyAccumulatedSeconds: 0,
  dailyDate: "",
  lastAccumulatedElapsed: 0,
};

const miniTimers = [];
let nextMiniTimerId = 1;

let mascotFrame = 0;
els.mascotWrap.classList.add("td1-frame");

function twoDigits(value) { return String(value).padStart(2, "0"); }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

function formatMiniDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${twoDigits(Math.floor(safe / 60))}:${twoDigits(safe % 60)}`;
}

function readMiniDuration(minuteInput, secondInput) {
  const minutes = clamp(Number(minuteInput.value) || 0, 0, 99);
  const seconds = clamp(Number(secondInput.value) || 0, 0, 59);
  minuteInput.value = minutes;
  secondInput.value = seconds;
  return minutes * 60 + seconds;
}

function renderMiniTimer(mini) {
  mini.display.textContent = formatMiniDuration(mini.remainingSeconds);
  mini.toggle.textContent = mini.running ? "일시정지" : "시작";
  mini.minutes.disabled = mini.running;
  mini.seconds.disabled = mini.running;
  mini.panel.classList.toggle("is-running", mini.running);
}

function stopMiniInterval(mini) {
  if (mini.timerId !== null) window.clearInterval(mini.timerId);
  mini.timerId = null;
}

function tickMiniTimer(mini) {
  if (!mini.running || mini.endAt === null) return;
  mini.remainingSeconds = Math.max(0, Math.ceil((mini.endAt - Date.now()) / 1000));
  if (mini.remainingSeconds === 0) {
    mini.running = false;
    mini.endAt = null;
    stopMiniInterval(mini);
    mini.panel.classList.add("is-finished");
  }
  renderMiniTimer(mini);
}

function startMiniTimer(mini) {
  if (mini.running) {
    tickMiniTimer(mini);
    mini.running = false;
    mini.endAt = null;
    stopMiniInterval(mini);
    renderMiniTimer(mini);
    return;
  }
  if (mini.remainingSeconds <= 0) mini.remainingSeconds = readMiniDuration(mini.minutes, mini.seconds);
  if (!mini.remainingSeconds) {
    mini.panel.classList.add("is-empty");
    return;
  }
  mini.panel.classList.remove("is-empty", "is-finished");
  mini.endAt = Date.now() + mini.remainingSeconds * 1000;
  mini.running = true;
  stopMiniInterval(mini);
  mini.timerId = window.setInterval(() => tickMiniTimer(mini), 200);
  renderMiniTimer(mini);
}

function resetMiniTimer(mini) {
  mini.running = false;
  mini.endAt = null;
  stopMiniInterval(mini);
  mini.remainingSeconds = readMiniDuration(mini.minutes, mini.seconds);
  mini.panel.classList.remove("is-empty", "is-finished");
  renderMiniTimer(mini);
}

function removeMiniTimer(mini) {
  mini.running = false;
  stopMiniInterval(mini);
  mini.panel.remove();
  const index = miniTimers.indexOf(mini);
  if (index >= 0) miniTimers.splice(index, 1);
  els.miniTimerButton.disabled = false;
}

function createMiniTimer() {
  if (miniTimers.length >= 4) return;
  const panel = document.createElement("section");
  panel.className = "mini-timer-panel";
  panel.innerHTML = `
    <div class="mini-timer-header"><strong>미니 타이머</strong><button class="mini-close" type="button" aria-label="미니 타이머 삭제">×</button></div>
    <div class="mini-display">05:00</div>
    <div class="mini-inputs">
      <label><input class="mini-minutes" type="number" min="0" max="99" value="5" aria-label="미니 타이머 분" />분</label>
      <label><input class="mini-seconds" type="number" min="0" max="59" value="0" aria-label="미니 타이머 초" />초</label>
    </div>
    <div class="mini-actions"><button class="mini-toggle" type="button">시작</button><button class="mini-reset" type="button">초기화</button></div>
  `;
  const mini = {
    id: nextMiniTimerId++, panel, display: panel.querySelector(".mini-display"), minutes: panel.querySelector(".mini-minutes"), seconds: panel.querySelector(".mini-seconds"), toggle: panel.querySelector(".mini-toggle"), running: false, remainingSeconds: 5 * 60, endAt: null, timerId: null,
  };
  panel.querySelector(".mini-close").addEventListener("click", () => removeMiniTimer(mini));
  mini.toggle.addEventListener("click", () => startMiniTimer(mini));
  panel.querySelector(".mini-reset").addEventListener("click", () => resetMiniTimer(mini));
  mini.minutes.addEventListener("input", () => { if (!mini.running) { mini.remainingSeconds = readMiniDuration(mini.minutes, mini.seconds); renderMiniTimer(mini); } });
  mini.seconds.addEventListener("input", () => { if (!mini.running) { mini.remainingSeconds = readMiniDuration(mini.minutes, mini.seconds); renderMiniTimer(mini); } });
  miniTimers.push(mini);
  els.miniTimersLayer.append(panel);
  els.miniTimerButton.disabled = miniTimers.length >= 4;
  renderMiniTimer(mini);
}

const DAILY_TOTAL_KEY = "seodanggae-daily-timer";
const QUICK_PRESET_KEY = "seodanggae-quick-presets";
let quickPresets = loadQuickPresets();

function loadQuickPresets() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(QUICK_PRESET_KEY) || "[]");
    return [...new Set(saved.map((value) => Number(value)).filter((value) => value > 0 && value <= 99 * 3600 + 59 * 60))].slice(0, 8);
  } catch (error) {
    return [];
  }
}

function saveQuickPresets() {
  try { window.localStorage.setItem(QUICK_PRESET_KEY, JSON.stringify(quickPresets)); } catch (error) { /* memory-only fallback */ }
}

function quickPresetLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  if (hours) return `${hours}시간${minutes ? ` ${minutes}분` : ""}`;
  if (restSeconds) return `${minutes}분 ${twoDigits(restSeconds)}초`;
  return `${minutes}분`;
}

function renderQuickPresets() {
  els.quickPresetList.replaceChildren();
  quickPresets.forEach((seconds) => {
    const item = document.createElement("span"); item.className = "quick-preset-item";
    const use = document.createElement("button"); use.type = "button"; use.className = "quick-preset"; use.textContent = quickPresetLabel(seconds); use.title = `${quickPresetLabel(seconds)} 설정`;
    use.addEventListener("click", () => {
      if (state.running) pauseTimer();
      setTimer(seconds);
      setStatus(`${quickPresetLabel(seconds)}을 설정했어요`);
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "quick-remove"; remove.textContent = "×"; remove.setAttribute("aria-label", `${quickPresetLabel(seconds)} 삭제`);
    remove.addEventListener("click", () => { quickPresets = quickPresets.filter((value) => value !== seconds); saveQuickPresets(); renderQuickPresets(); });
    item.append(use, remove); els.quickPresetList.append(item);
  });
}

function addQuickPreset() {
  const seconds = valuesToSeconds();
  if (!seconds) { setStatus("저장할 시간을 먼저 입력해 주세요"); timeInputs.hours.focus(); return; }
  if (quickPresets.includes(seconds)) { setStatus("이미 저장된 시간이에요"); return; }
  if (quickPresets.length >= 8) { setStatus("자주 쓰는 시간은 최대 8개까지 저장할 수 있어요"); return; }
  quickPresets.push(seconds);
  quickPresets.sort((a, b) => a - b);
  saveQuickPresets();
  renderQuickPresets();
  setStatus(`${quickPresetLabel(seconds)}을 저장했어요`);
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

function loadDailyAccumulation() {
  const today = todayKey();
  state.dailyDate = today;
  try {
    const saved = JSON.parse(window.localStorage.getItem(DAILY_TOTAL_KEY) || "null");
    if (saved?.date === today) return Math.max(0, Number(saved.seconds) || 0);
  } catch (error) {
    // localStorage may be unavailable in private or file-based browsing contexts.
  }
  return 0;
}

function saveDailyAccumulation() {
  try {
    window.localStorage.setItem(DAILY_TOTAL_KEY, JSON.stringify({
      date: state.dailyDate,
      seconds: state.dailyAccumulatedSeconds,
    }));
  } catch (error) {
    // Keep the in-memory total when persistent storage is unavailable.
  }
}

function ensureToday() {
  const today = todayKey();
  if (state.dailyDate !== today) {
    state.dailyDate = today;
    state.dailyAccumulatedSeconds = 0;
    saveDailyAccumulation();
  }
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours}시간 ${twoDigits(minutes)}분 ${twoDigits(seconds)}초`;
}

function updateDailyAccumulation() {
  ensureToday();
  els.dailyAccumulation.hidden = state.mode === "mock";
  if (state.mode === "mock") return;
  els.dailyAccumulation.textContent = `오늘 누적 ${formatDuration(state.dailyAccumulatedSeconds)}`;
}

function shouldAccumulate() {
  return state.mode === "normal" || (state.mode === "pomodoro" && state.phase === "work");
}

function recordElapsed(elapsed) {
  const effectiveElapsed = state.stopwatch
    ? elapsed
    : Math.min(elapsed, state.segmentSeconds);
  const delta = Math.max(0, effectiveElapsed - state.lastAccumulatedElapsed);
  state.lastAccumulatedElapsed = effectiveElapsed;
  if (!delta || !shouldAccumulate()) return;
  ensureToday();
  state.dailyAccumulatedSeconds += delta;
  saveDailyAccumulation();
}

state.dailyAccumulatedSeconds = loadDailyAccumulation();

function valuesToSeconds() {
  const hours = clamp(Number(timeInputs.hours.value) || 0, 0, 99);
  const minutes = clamp(Number(timeInputs.minutes.value) || 0, 0, 59);
  return hours * 3600 + minutes * 60;
}

function secondsForMode() {
  if (state.mode === "pomodoro") return state.phase === "break" ? 5 * 60 : 25 * 60;
  if (state.mode === "mock" && state.examSubject === "full-day") {
    return MOCK_DAY_SCHEDULE[state.scheduleIndex].seconds;
  }
  if (state.mode === "mock") return EXAM_SLOTS[state.examSubject].seconds;
  return valuesToSeconds();
}

function currentMockScheduleItem() {
  return MOCK_DAY_SCHEDULE[state.scheduleIndex];
}

function render(totalSeconds = state.currentSeconds) {
  const safeTotal = clamp(Math.floor(totalSeconds), 0, 99 * 3600 + 59 * 60);
  const hours = Math.floor(safeTotal / 3600);
  const minutes = Math.floor((safeTotal % 3600) / 60);
  const seconds = safeTotal % 60;
  timeInputs.hours.value = twoDigits(hours);
  timeInputs.minutes.value = twoDigits(minutes);
  els.secondsDisplay.textContent = `${twoDigits(seconds)}초`;
  els.secondsHint.textContent = "초 단위까지 표시되는 타이머";
  document.title = `${twoDigits(hours)}시간 ${twoDigits(minutes)}분 · 서당개 타이머`;
}

function stopInterval() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function stopAlarm() {
  if (state.alarmId !== null) {
    window.clearInterval(state.alarmId);
    state.alarmId = null;
  }
  state.alarmUntil = null;
}

function setStatus(text) { els.statusText.textContent = text; }

function updateModeDetails() {
  els.modeName.textContent = MODE_NAMES[state.mode];
  els.pomodoroOptions.hidden = state.mode !== "pomodoro";
  els.mockOptions.hidden = state.mode !== "mock";
  els.quickPresets.hidden = state.mode !== "normal";
  els.timerSubject.value = state.subject;
  updateSubjectDisplay();
  updateMockSubjectLabel();
}

function updateSubjectDisplay() {
  const selected = els.timerSubject.selectedOptions[0];
  els.timerSubjectDisplay.textContent = selected?.value ? selected.textContent : "과목 선택";
  els.timerSubjectControl.classList.remove("is-editing");
}

function updateMockSubjectLabel() {
  const isFullDay = state.mode === "mock" && state.examSubject === "full-day";
  els.mockSubjectLabel.hidden = !isFullDay;
  if (isFullDay) els.mockSubjectLabel.textContent = `현재: ${currentMockScheduleItem().name}`;
}

function updateControls() {
  els.toggleButton.classList.toggle("running", state.running);
  els.toggleButton.setAttribute("aria-label", state.running ? "타이머 일시정지" : "타이머 시작");
  els.toggleLabel.textContent = state.running ? "잠시 멈춤" : "시작";
  els.phaseLabel.textContent = state.mode === "pomodoro"
    ? `${state.round}회차 · ${state.phase === "work" ? "집중 시간" : "휴식 시간"}`
    : state.mode === "mock"
      ? state.examSubject === "full-day"
        ? `${currentMockScheduleItem().name} · ${currentMockScheduleItem().type === "break" ? "휴식" : "시험"} ${Math.floor(currentMockScheduleItem().seconds / 60)}분`
        : `${EXAM_SLOTS[state.examSubject].name} · 제한 시간 ${Math.floor(EXAM_SLOTS[state.examSubject].seconds / 60)}분`
      : state.stopwatch ? "스톱워치" 
      : state.currentSeconds > 0 ? "설정한 시간만큼 집중해 보세요" : "시간을 입력하고 시작해 주세요";
  updateMockSubjectLabel();
  updateDailyAccumulation();
}

function setTimer(seconds, { saveAsInitial = true } = {}) {
  state.stopwatch = false;
  state.stopwatchElapsed = 0;
  state.currentSeconds = clamp(Math.floor(seconds), 0, 99 * 3600 + 59 * 60);
  if (saveAsInitial) state.initialSeconds = state.currentSeconds;
  state.segmentSeconds = state.currentSeconds;
  render();
  updateControls();
}

function finishTimer() {
  stopInterval();
  state.running = false;
  state.startedAt = null;
  state.currentSeconds = 0;
  render();
  updateControls();
  document.body.classList.add("is-finished");

  if (state.mode === "pomodoro" && state.phase === "work") {
    playAlarm();
    if (state.round < state.totalRounds) {
      state.phase = "break";
      setTimer(secondsForMode());
      setStatus(`${state.round}회차 집중 완료 · 5분 휴식 시간이에요`);
    } else {
      setStatus("뽀모도로를 모두 완료했어요");
    }
  } else if (state.mode === "pomodoro" && state.phase === "break") {
    playAlarm();
    state.round += 1;
    state.phase = "work";
    setTimer(secondsForMode());
    setStatus(`${state.round}회차 집중 시간이 준비됐어요`);
  } else if (state.mode === "mock" && state.examSubject === "full-day") {
    playAlarm();
    if (state.scheduleIndex < MOCK_DAY_SCHEDULE.length - 1) {
      const finishedItem = currentMockScheduleItem();
      state.scheduleIndex += 1;
      const nextItem = currentMockScheduleItem();
      setTimer(secondsForMode());
      setStatus(`${finishedItem.name} 종료 · ${nextItem.name} ${Math.floor(nextItem.seconds / 60)}분 시작`);
      state.segmentSeconds = state.currentSeconds;
      state.startedAt = Date.now();
      state.running = true;
      state.lastAccumulatedElapsed = 0;
      stopInterval();
      state.timerId = window.setInterval(tick, 200);
      tick();
    } else {
      setStatus("고1·고2 하루 시간표가 끝났어요");
    }
  } else {
    playAlarm();
    setStatus(state.mode === "mock" ? "시험 시간이 끝났어요" : "타이머가 끝났어요");
  }
  window.setTimeout(() => document.body.classList.remove("is-finished"), 1900);
}

function tick() {
  if (!state.running || state.startedAt === null) return;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  recordElapsed(elapsed);
  state.currentSeconds = state.stopwatch
    ? clamp(state.stopwatchElapsed + elapsed, 0, 99 * 3600 + 59 * 60)
    : Math.max(0, state.segmentSeconds - elapsed);
  render();
  updateControls();
  if (state.currentSeconds === 0 && !state.stopwatch) finishTimer();
}

function startTimer() {
  if ((state.mode === "normal" || state.mode === "pomodoro") && !state.subject) {
    setStatus("과목을 먼저 선택해 주세요");
    els.timerSubject.focus();
    return;
  }
  if (!state.currentSeconds) {
    const nextSeconds = secondsForMode();
    if (!nextSeconds) {
      if (state.mode !== "normal") {
        setStatus("먼저 타이머 숫자를 클릭하고 시간을 입력해 주세요");
        timeInputs.hours.focus();
        return;
      }
      state.stopwatch = true;
      state.stopwatchElapsed = 0;
    } else {
      setTimer(nextSeconds);
    }
  }
  if (state.stopwatch) state.stopwatchElapsed = state.currentSeconds;
  state.segmentSeconds = state.currentSeconds;
  state.lastAccumulatedElapsed = 0;
  state.startedAt = Date.now();
  state.running = true;
  stopInterval();
  state.timerId = window.setInterval(tick, 200);
  setStatus(state.mode === "pomodoro"
    ? `${state.round}회차 ${state.phase === "work" ? "집중" : "휴식"}을 시작했어요`
    : state.stopwatch ? "스톱워치를 시작했어요" : "타이머가 시작됐어요");
  updateControls();
  tick();
}

function pauseTimer() {
  tick();
  stopInterval();
  state.startedAt = null;
  if (state.stopwatch) state.stopwatchElapsed = state.currentSeconds;
  state.segmentSeconds = state.currentSeconds;
  state.running = false;
  updateControls();
  setStatus("잠시 멈췄어요. 시작 버튼을 누르면 이어집니다");
}

function resetTimer() {
  stopInterval();
  stopAlarm();
  state.startedAt = null;
  state.running = false;
  state.stopwatch = false;
  state.stopwatchElapsed = 0;
  state.lastAccumulatedElapsed = 0;
  state.phase = "work";
  state.round = 1;
  state.scheduleIndex = 0;
  const seconds = state.mode === "normal" ? state.initialSeconds : secondsForMode();
  setTimer(seconds);
  document.body.classList.remove("is-finished");
  setStatus("타이머를 되돌렸어요");
}

function ensureAudio() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    state.audioContext = new AudioContextClass();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function beep() {
  if (state.sound === "mute") return;
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(740, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(520, context.currentTime + .22);
  gain.gain.setValueAtTime(.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .02);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .28);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + .3);
}

function playAlarm() {
  stopAlarm();
  if (state.sound === "mute") {
    setStatus("시간이 끝났어요 · 화면이 흔들리고 있어요");
    return;
  }
  beep();
  state.alarmUntil = state.sound === "until-reset" ? Infinity : Date.now() + Number(state.sound) * 1000;
  state.alarmId = window.setInterval(() => {
    if (Date.now() >= state.alarmUntil) { stopAlarm(); return; }
    beep();
  }, 900);
}

function openSettings() {
  els.settingsPanel.hidden = false;
  els.settingsBackdrop.hidden = false;
  els.settingsButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => document.querySelector("input[name='mode']:checked")?.focus(), 0);
}

function closeSettings() {
  els.settingsPanel.hidden = true;
  els.settingsBackdrop.hidden = true;
  els.settingsButton.setAttribute("aria-expanded", "false");
}

function applySettings() {
  const nextMode = document.querySelector("input[name='mode']:checked").value;
  state.mode = nextMode;
  state.subject = els.timerSubject.value;
  state.sound = document.querySelector("input[name='sound']:checked").value;
  state.totalRounds = clamp(Number(els.roundCount.value) || 1, 1, 12);
  els.roundCount.value = state.totalRounds;
  state.examSubject = els.examSubject.value;
  stopInterval();
  stopAlarm();
  state.running = false;
  state.startedAt = null;
  state.phase = "work";
  state.round = 1;
  state.scheduleIndex = 0;
  setTimer(state.mode === "normal" ? state.initialSeconds : secondsForMode());
  updateModeDetails();
  setStatus(`${MODE_NAMES[state.mode]} 설정을 저장했어요`);
  closeSettings();
}

function beginEditing(input) {
  if (state.running) pauseTimer();
  window.setTimeout(() => input.select(), 0);
}

function normalizeInput(input) {
  const max = input === timeInputs.hours ? 99 : 59;
  const value = clamp(Number(input.value) || 0, 0, max);
  input.value = twoDigits(value);
  state.currentSeconds = valuesToSeconds();
  state.initialSeconds = state.currentSeconds;
  state.segmentSeconds = state.currentSeconds;
  render();
  updateControls();
  setStatus("입력한 시간으로 준비했어요");
}

Object.values(timeInputs).forEach((input) => {
  input.addEventListener("focus", () => beginEditing(input));
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 2);
    state.currentSeconds = valuesToSeconds();
    state.initialSeconds = state.currentSeconds;
    state.segmentSeconds = state.currentSeconds;
    setStatus("원하는 시간을 입력한 뒤 시작을 눌러 주세요");
  });
  input.addEventListener("blur", () => normalizeInput(input));
  input.addEventListener("keydown", (event) => {
    const max = input === timeInputs.hours ? 99 : 59;
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      input.value = twoDigits(clamp((Number(input.value) || 0) + (event.key === "ArrowUp" ? 1 : -1), 0, max));
      normalizeInput(input);
      input.select();
    }
  });
});

els.toggleButton.addEventListener("click", () => state.running ? pauseTimer() : startTimer());
els.resetButton.addEventListener("click", resetTimer);
els.settingsButton.addEventListener("click", openSettings);
els.miniTimerButton.addEventListener("click", createMiniTimer);
els.saveQuickPreset.addEventListener("click", addQuickPreset);
els.closeSettings.addEventListener("click", closeSettings);
els.saveSettings.addEventListener("click", applySettings);
els.settingsBackdrop.addEventListener("click", closeSettings);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.settingsPanel.hidden) closeSettings(); });

document.querySelectorAll("input[name='mode']").forEach((radio) => radio.addEventListener("change", () => {
  els.pomodoroOptions.hidden = radio.value !== "pomodoro" || !radio.checked;
  els.mockOptions.hidden = radio.value !== "mock" || !radio.checked;
}));

els.timerSubject.addEventListener("change", () => {
  state.subject = els.timerSubject.value;
  updateSubjectDisplay();
  setStatus(state.subject ? `${els.timerSubject.selectedOptions[0].textContent} 과목을 선택했어요` : "과목을 선택해 주세요");
});
els.timerSubject.addEventListener("blur", updateSubjectDisplay);

els.timerSubjectDisplay.addEventListener("click", () => {
  els.timerSubjectControl.classList.add("is-editing");
  els.timerSubject.focus();
  try { els.timerSubject.showPicker(); } catch (error) { els.timerSubject.click(); }
});

window.setInterval(() => {
  mascotFrame = mascotFrame === 0 ? 1 : 0;
  els.mascotWrap.classList.toggle("td1-frame", mascotFrame === 0);
  els.mascotWrap.classList.toggle("td2-frame", mascotFrame === 1);
  els.mascot.src = mascotFrame === 0 ? "td1.png" : "td2.png";
}, 400);

els.examSubject.addEventListener("change", () => {
  if (document.querySelector("input[name='mode']:checked").value !== "mock") return;
  setStatus(els.examSubject.value === "full-day"
    ? "고1·고2 하루 전체 시간표를 선택했어요"
    : `${EXAM_SLOTS[els.examSubject.value].name} 시간을 선택했어요`);
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

setTimer(0);
renderQuickPresets();
updateModeDetails();
updateControls();
