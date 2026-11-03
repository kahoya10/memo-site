const STORAGE_PREFIX = "planner-lab-";
const inkStates = new Map();
const els = {
  deviceStatus: document.querySelector("#deviceStatus"),
};

function storageKey(field, suffix) {
  return `${STORAGE_PREFIX}${field}-${suffix}`;
}

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    t: Date.now(),
    pressure: event.pressure || 0.5,
  };
}

function setupCanvas(canvas, state) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.context = context;
  redraw(state);
}

function redraw(state) {
  if (!state.context) return;
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  state.context.clearRect(0, 0, rect.width, rect.height);
  state.strokes.forEach((stroke) => {
    if (stroke.points.length < 1) return;
    state.context.beginPath();
    state.context.lineCap = "round";
    state.context.lineJoin = "round";
    state.context.strokeStyle = stroke.color;
    state.context.lineWidth = stroke.size;
    state.context.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => state.context.lineTo(point.x, point.y));
    if (stroke.points.length === 1) state.context.lineTo(stroke.points[0].x + .1, stroke.points[0].y + .1);
    state.context.stroke();
  });
}

function saveInk(state) {
  writeJson(storageKey(state.field, "strokes"), state.strokes);
}

function setCardStatus(state, message) {
  state.status.textContent = message;
}

function switchMode(state, mode) {
  state.mode = mode;
  state.card.dataset.mode = mode;
  state.card.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  state.textarea.hidden = mode !== "text";
  state.canvas.hidden = mode !== "ink";
  state.toolbar.hidden = mode !== "ink";
  state.status.hidden = mode === "ink";
  if (mode === "ink") {
    requestAnimationFrame(() => setupCanvas(state.canvas, state));
    setCardStatus(state, "펜으로 쓰거나 마우스로 테스트할 수 있습니다.");
  } else {
    setCardStatus(state, "텍스트 입력 모드");
  }
}

function setupInkCard(card) {
  const field = card.dataset.inkField;
  const canvas = card.querySelector(".ink-canvas");
  const palettePicker = card.querySelector(".palette-picker");
  const paletteTabs = card.querySelector(".palette-tabs");
  const extraPalettes = {
    neon: { label: "네온", colors: ["#ff4f81", "#ff9f1c", "#00b8d9", "#55c91f", "#a855f7"] },
    nature: { label: "자연", colors: ["#315c4b", "#6f8f72", "#b27658", "#557a9f", "#9b8065"] },
  };
  Object.entries(extraPalettes).forEach(([name, palette]) => {
    const tab = document.createElement("button");
    tab.className = "palette-tab";
    tab.type = "button";
    tab.dataset.palette = name;
    tab.textContent = palette.label;
    paletteTabs.append(tab);
    const colors = document.createElement("div");
    colors.className = "palette-colors";
    colors.dataset.paletteColors = name;
    colors.hidden = true;
    colors.innerHTML = "<span>색상</span>";
    palette.colors.forEach((color, index) => {
      const swatch = document.createElement("button");
      swatch.className = `color-swatch${index === 0 ? " is-active" : ""}`;
      swatch.type = "button";
      swatch.dataset.color = color;
      swatch.style.setProperty("--swatch", color);
      swatch.setAttribute("aria-label", `${palette.label} ${index + 1}`);
      colors.append(swatch);
    });
    palettePicker.append(colors);
  });
  const pastelColors = ["#a8dcfa", "#f6b8d4", "#ffd18a", "#b9e6bd", "#e2ccff"];
  card.querySelectorAll('[data-palette-colors="pastel"] .color-swatch').forEach((swatch, index) => {
    swatch.dataset.color = pastelColors[index];
    swatch.style.setProperty("--swatch", pastelColors[index]);
  });
  const paletteMenu = document.createElement("button");
  paletteMenu.className = "palette-menu-button";
  paletteMenu.type = "button";
  paletteMenu.textContent = "기본 팔레트 ▾";
  paletteMenu.setAttribute("aria-expanded", "false");
  paletteMenu.setAttribute("aria-haspopup", "true");
  palettePicker.insertBefore(paletteMenu, paletteTabs);
  const state = {
    field,
    card,
    canvas,
    context: null,
    textarea: card.querySelector(".text-editor"),
    toolbar: card.querySelector(".ink-toolbar"),
    status: card.querySelector(".card-status"),
    size: card.querySelector(".pen-size"),
    color: card.querySelector(".color-swatch.is-active")?.dataset.color || "#4f6680",
    strokes: readJson(storageKey(field, "strokes"), []),
    mode: "text",
    activeStroke: null,
  };
  const savedText = localStorage.getItem(storageKey(field, "text"));
  if (savedText) state.textarea.value = savedText;
  state.textarea.addEventListener("input", () => localStorage.setItem(storageKey(field, "text"), state.textarea.value));

  card.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => switchMode(state, button.dataset.mode));
  });
  paletteMenu.addEventListener("click", () => {
    const isOpen = paletteTabs.classList.toggle("is-open");
    paletteMenu.setAttribute("aria-expanded", String(isOpen));
  });
  card.querySelectorAll(".palette-tab").forEach((button) => {
    button.addEventListener("click", () => {
      card.querySelectorAll(".palette-tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      paletteMenu.textContent = `${button.textContent} 팔레트 ▾`;
      card.querySelectorAll(".palette-colors").forEach((palette) => {
        palette.hidden = palette.dataset.paletteColors !== button.dataset.palette;
      });
      const activeSwatch = card.querySelector(`[data-palette-colors="${button.dataset.palette}"] .color-swatch.is-active`);
      if (activeSwatch) state.color = activeSwatch.dataset.color;
      paletteTabs.classList.remove("is-open");
      paletteMenu.setAttribute("aria-expanded", "false");
    });
  });
  card.querySelectorAll(".color-swatch").forEach((button) => {
    button.addEventListener("click", () => {
      state.color = button.dataset.color;
      button.closest(".palette-colors").querySelectorAll(".color-swatch").forEach((swatch) => swatch.classList.toggle("is-active", swatch === button));
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!palettePicker.contains(event.target)) {
      paletteTabs.classList.remove("is-open");
      paletteMenu.setAttribute("aria-expanded", "false");
    }
  });
  card.querySelector(".undo-button").addEventListener("click", () => {
    state.strokes.pop();
    saveInk(state);
    redraw(state);
    setCardStatus(state, "마지막 필기를 되돌렸습니다.");
  });
  card.querySelector(".clear-button").addEventListener("click", () => {
    state.strokes = [];
    saveInk(state);
    redraw(state);
    setCardStatus(state, "필기를 모두 지웠습니다.");
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    state.activeStroke = {
      color: state.color,
      size: Number(state.size.value),
      points: [pointFromEvent(canvas, event)],
    };
    els.deviceStatus.textContent = event.pointerType === "pen" ? "펜 입력이 감지되었습니다." : "마우스·터치 입력이 감지되었습니다.";
    redraw({ ...state, strokes: [...state.strokes, state.activeStroke] });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.activeStroke) return;
    state.activeStroke.points.push(pointFromEvent(canvas, event));
    redraw({ ...state, strokes: [...state.strokes, state.activeStroke] });
  });
  const finishStroke = () => {
    if (!state.activeStroke) return;
    state.strokes.push(state.activeStroke);
    state.activeStroke = null;
    saveInk(state);
    redraw(state);
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  inkStates.set(field, state);
  return state;
}

document.querySelectorAll(".ink-card").forEach(setupInkCard);

window.addEventListener("resize", () => inkStates.forEach((state) => {
  if (state.mode === "ink") setupCanvas(state.canvas, state);
}));
