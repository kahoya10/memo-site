(() => {
  const app = document.getElementById("editorApp");
  if (!app) return;

  const canvas = document.getElementById("inkCanvas");
  const paper = document.getElementById("paper");
  const paperSizer = document.getElementById("paperSizer");
  const viewport = document.getElementById("paperViewport");
  const panButton = document.getElementById("panButton");
  const fitPageButton = document.getElementById("fitPageButton");
  const zoomLabel = document.getElementById("zoomLabel");
  const readOnly = app.dataset.readonly === "true";
  const context = canvas.getContext("2d");
  const graphitePatterns = new Map();
  let graphiteGrain;
  const csrf = app.querySelector("input[name=csrfmiddlewaretoken]").value;
  const clone = value => JSON.parse(JSON.stringify(value));
  const initial = JSON.parse(document.getElementById("initial-ink").textContent || "[]");
  const initialTextBoxes = JSON.parse(document.getElementById("initial-text-boxes").textContent || "[]");
  const initialStickyNotes = JSON.parse(document.getElementById("initial-sticky-notes").textContent || "[]");
  const preferences = JSON.parse(document.getElementById("drawing-preferences").textContent || "{}");
  const pagePreviews = JSON.parse(document.getElementById("page-previews").textContent || "[]");

  let strokes = Array.isArray(initial) ? initial : [];
  let textBoxes = Array.isArray(initialTextBoxes) ? initialTextBoxes : [];
  let stickyNotes = Array.isArray(initialStickyNotes) ? initialStickyNotes : [];
  strokes.forEach((stroke, index) => { if (!stroke.id) stroke.id = `stroke-${Date.now()}-${index}`; });
  let tools = Array.isArray(preferences.tools) ? preferences.tools : [];
  let palettes = Array.isArray(preferences.palettes) ? preferences.palettes : [];
  let activePaletteId = preferences.active_palette || palettes[0]?.id;
  let eraserMode = preferences.eraser_mode || "stroke";
  let palmMode = preferences.palm_rejection || "auto";
  let activeToolId = tools.find(item => item.group === "general")?.id || tools[0]?.id;
  let activeSpecial = null;
  let lastToolClickId = null;
  let settingsToolId = null;
  let pendingColor = null;
  let newPaletteColors = [];
  let activeStroke = null;
  let activePointerId = null;
  let lassoPoints = [];
  let eraseChanged = false;
  let undoStack = [];
  let redoStack = [];
  let saveTimer = null;
  let preferenceTimer = null;
  let pendingSave = Promise.resolve(true);
  let zoom = 1;
  let basePaperWidth = 794;
  let viewFit = "width";
  let resizeFrame = 0;
  let canvasSized = false;
  let panMode = false;
  let fingerInkEnabled = false;
  let spacePressed = false;
  let pointerPan = null;
  let hasDetectedPen = false;
  const touchPointers = new Map();
  let touchGesture = null;
  let touchSession = null;
  let navigatingPage = false;
  let selection = null;
  let selectionMove = null;
  let objectDrag = null;
  const drawer = document.getElementById("pageDrawer");
  const drawerButton = document.getElementById("togglePageDrawer");
  const narrowScreen = matchMedia("(max-width: 800px)");
  function setDrawer(open) {
    app.classList.toggle("drawer-open", open);
    drawer.inert = !open;
    drawerButton.setAttribute("aria-expanded", String(open));
  }
  setDrawer(!narrowScreen.matches);
  narrowScreen.addEventListener("change", () => setDrawer(!narrowScreen.matches));
  drawerButton.addEventListener("click", () => setDrawer(drawer.inert));
  drawer.addEventListener("keydown", event => {
    if (event.key === "Escape") { setDrawer(false); drawerButton.focus(); }
  });
  const activeChapter = document.querySelector(".page-link.active")?.closest(".chapter-group");
  if (activeChapter) {
    activeChapter.querySelector(".chapter-pages").hidden = false;
    const toggle = activeChapter.querySelector(".chapter-toggle");
    toggle.setAttribute("aria-expanded", "true");
    toggle.querySelector("b").textContent = "−";
  }
  document.querySelectorAll(".chapter-delete-form, .page-delete-form").forEach(form => form.addEventListener("submit", event => {
    const description = form.classList.contains("chapter-delete-form") ? "이 챕터와 모든 페이지" : "이 페이지";
    if (!window.confirm(`${description}를 삭제할까요?`)) event.preventDefault();
  }));

  const toolSettingsDialog = document.getElementById("toolSettingsDialog");
  const eraserDialog = document.getElementById("eraserDialog");
  const newToolDialog = document.getElementById("newToolDialog");

  function currentTool() { return tools.find(item => item.id === activeToolId) || tools[0]; }
  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }
  function distance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function midpoint(a, b) { return {x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2}; }
  function snapshot() { return {strokes: clone(strokes), textBoxes: clone(textBoxes), stickyNotes: clone(stickyNotes)}; }
  function restoreSnapshot(state) { strokes = state.strokes; textBoxes = state.textBoxes; stickyNotes = state.stickyNotes; renderPaperObjects(); redraw(); }
  function beginHistory() { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; }

  function resizeCanvas() {
    const rect = paper.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(1, rect.width, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function createGraphiteGrain() {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 96;
    const tileContext = tile.getContext("2d");
    const grain = tileContext.createImageData(tile.width, tile.height);
    // Use the same paper grain every time the canvas is redrawn.
    let seed = 73519;
    const sample = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const coarseGrain = Array.from({length: tile.width * tile.height / 4}, sample);
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        const tooth = coarseGrain[Math.floor(y / 2) * (tile.width / 2) + Math.floor(x / 2)];
        const fleck = sample();
        const coverage = tooth < .17 ? .16 + .5 * fleck : .48 + .32 * tooth + .2 * fleck;
        grain.data[(y * tile.width + x) * 4 + 3] = Math.round(255 * coverage);
      }
    }
    tileContext.putImageData(grain, 0, 0);
    return tile;
  }

  function graphitePattern(color) {
    if (graphitePatterns.has(color)) return graphitePatterns.get(color);
    graphiteGrain ??= createGraphiteGrain();
    const tile = document.createElement("canvas");
    tile.width = graphiteGrain.width;
    tile.height = graphiteGrain.height;
    const tileContext = tile.getContext("2d");
    tileContext.drawImage(graphiteGrain, 0, 0);
    tileContext.globalCompositeOperation = "source-in";
    tileContext.fillStyle = "#343A40";
    tileContext.fillStyle = color;
    tileContext.fillRect(0, 0, tile.width, tile.height);
    const pattern = context.createPattern(tile, "repeat");
    pattern.setTransform(new DOMMatrix().scale(.5));
    if (graphitePatterns.size >= 32) graphitePatterns.delete(graphitePatterns.keys().next().value);
    graphitePatterns.set(color, pattern);
    return pattern;
  }

  function renderStroke(stroke) {
    if (!stroke.points || stroke.points.length < 1) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Number(stroke.width) || 2;
    const color = stroke.color || "#343A40";
    context.strokeStyle = stroke.tool === "pencil" ? graphitePattern(color) : color;
    const fallbackOpacity = stroke.tool === "highlighter" ? 0.32 : stroke.tool === "pencil" ? 0.72 : 1;
    context.globalAlpha = Number.isFinite(Number(stroke.opacity)) ? Number(stroke.opacity) : fallbackOpacity;
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point[0] * canvas.clientWidth;
      const y = point[1] * canvas.clientHeight;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    if (stroke.points.length === 1) context.lineTo(stroke.points[0][0] * canvas.clientWidth + .1, stroke.points[0][1] * canvas.clientHeight + .1);
    context.stroke();
    context.restore();
  }

  function objectCollection(type) { return type === "text" ? textBoxes : stickyNotes; }
  function findPaperObject(type, id) { return objectCollection(type).find(item => item.id === id); }
  function selectionBounds() {
    if (!selection) return null;
    const points = [];
    strokes.filter(item => selection.strokeIds.includes(item.id)).forEach(item => points.push(...(item.points || [])));
    selection.textIds.forEach(id => { const item = findPaperObject("text", id); if (item) points.push([item.x, item.y], [item.x + item.width, item.y + item.height]); });
    selection.noteIds.forEach(id => { const item = findPaperObject("memo", id); if (item) points.push([item.x, item.y], [item.x + item.width, item.y + item.height]); });
    if (!points.length) return null;
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    return {left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)};
  }

  function updateSelectionUI() {
    const hasSelection = Boolean(selectionBounds());
    document.getElementById("selectionActions").hidden = !hasSelection;
    document.getElementById("convertSelection").hidden = !selection?.strokeIds.length;
    renderPaperObjects();
  }

  function redraw() {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    strokes.forEach(renderStroke);
    if (lassoPoints.length > 1) {
      context.save();
      context.setLineDash([7, 5]);
      context.lineWidth = 2;
      context.strokeStyle = "#426b57";
      context.beginPath();
      lassoPoints.forEach((point, index) => {
        const x = point[0] * canvas.clientWidth;
        const y = point[1] * canvas.clientHeight;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
      context.restore();
    }
    const bounds = selectionBounds();
    if (bounds) {
      context.save();
      context.setLineDash([6, 4]);
      context.strokeStyle = "#426b57";
      context.lineWidth = 1.5;
      context.strokeRect(bounds.left * canvas.clientWidth - 5, bounds.top * canvas.clientHeight - 5, (bounds.right - bounds.left) * canvas.clientWidth + 10, (bounds.bottom - bounds.top) * canvas.clientHeight + 10);
      context.restore();
    }
  }

  function renderPaperObjects() {
    const layer = document.getElementById("objectLayer");
    layer.classList.toggle("objects-interactive", ["text", "memo"].includes(activeSpecial));
    const makeObject = (item, type) => {
      const wrapper = document.createElement("div");
      wrapper.className = `paper-object ${type === "memo" ? "sticky-note" : "text-box"}`;
      wrapper.dataset.objectId = item.id;
      wrapper.dataset.objectType = type;
      wrapper.style.left = `${item.x * 100}%`; wrapper.style.top = `${item.y * 100}%`;
      wrapper.style.width = `${item.width * 100}%`; wrapper.style.height = `${item.height * 100}%`;
      if (type === "memo") wrapper.style.backgroundColor = item.color || "#FFF2A8";
      const handle = document.createElement("button");
      handle.type = "button"; handle.className = "object-drag-handle"; handle.textContent = "⋮⋮"; handle.title = "끌어서 이동";
      const input = document.createElement("textarea");
      input.value = item.text || ""; input.placeholder = type === "memo" ? "메모를 입력하세요" : "텍스트를 입력하세요";
      input.addEventListener("focus", () => { if (!input.dataset.history) { beginHistory(); input.dataset.history = "1"; } });
      input.addEventListener("blur", () => { delete input.dataset.history; });
      input.addEventListener("input", () => { item.text = input.value; markChanged(); });
      handle.addEventListener("pointerdown", event => {
        event.preventDefault(); event.stopPropagation(); beginHistory();
        objectDrag = {type, id: item.id, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y};
        handle.setPointerCapture(event.pointerId);
      });
      const selected = selection && (type === "text" ? selection.textIds : selection.noteIds).includes(item.id);
      wrapper.classList.toggle("selected", Boolean(selected));
      wrapper.append(handle, input);
      return wrapper;
    };
    layer.replaceChildren(...textBoxes.map(item => makeObject(item, "text")), ...stickyNotes.map(item => makeObject(item, "memo")));
  }

  window.addEventListener("pointermove", event => {
    if (!objectDrag) return;
    const item = findPaperObject(objectDrag.type, objectDrag.id);
    if (!item) return;
    item.x = Math.max(0, Math.min(1 - item.width, objectDrag.x + (event.clientX - objectDrag.startX) / paper.clientWidth));
    item.y = Math.max(0, Math.min(1 - item.height, objectDrag.y + (event.clientY - objectDrag.startY) / paper.clientHeight));
    renderPaperObjects(); redraw();
  });
  window.addEventListener("pointerup", () => { if (objectDrag) { objectDrag = null; markChanged(); } });

  function markChanged() {
    document.getElementById("saveStatus").textContent = "저장 대기";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePage(), 850);
    renderCurrentThumbnail();
  }

  function drawPreviewStroke(previewContext, previewCanvas, stroke) {
    if (!stroke.points?.length) return;
    const fallbackOpacity = stroke.tool === "highlighter" ? 0.32 : stroke.tool === "pencil" ? 0.72 : 1;
    previewContext.save();
    previewContext.lineCap = "round";
    previewContext.lineJoin = "round";
    previewContext.lineWidth = Math.max(.5, (Number(stroke.width) || 2) * previewCanvas.width / 794);
    previewContext.strokeStyle = stroke.color || "#343A40";
    const opacity = Number.isFinite(Number(stroke.opacity)) ? Number(stroke.opacity) : fallbackOpacity;
    // Individual grains are too small to resolve at thumbnail size.
    previewContext.globalAlpha = stroke.tool === "pencil" ? opacity * .68 : opacity;
    previewContext.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    previewContext.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point[0] * previewCanvas.width;
      const y = point[1] * previewCanvas.height;
      if (index === 0) previewContext.moveTo(x, y); else previewContext.lineTo(x, y);
    });
    if (stroke.tool === "pencil" && stroke.points.length === 1) {
      previewContext.lineTo(stroke.points[0][0] * previewCanvas.width + .1, stroke.points[0][1] * previewCanvas.height + .1);
    }
    previewContext.stroke();
    previewContext.restore();
  }

  function drawPageThumbnail(previewCanvas, data) {
    if (!previewCanvas || !data) return;
    const previewContext = previewCanvas.getContext("2d");
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    (data.ink_data || []).forEach(stroke => drawPreviewStroke(previewContext, previewCanvas, stroke));
    (data.text_boxes || []).forEach(item => {
      previewContext.fillStyle = "#253346"; previewContext.font = "4px sans-serif";
      previewContext.fillText(String(item.text || "").slice(0, 22), item.x * previewCanvas.width, (item.y + .03) * previewCanvas.height, item.width * previewCanvas.width);
    });
    (data.sticky_notes || []).forEach(item => {
      previewContext.fillStyle = item.color || "#FFF2A8";
      previewContext.fillRect(item.x * previewCanvas.width, item.y * previewCanvas.height, item.width * previewCanvas.width, item.height * previewCanvas.height);
      previewContext.fillStyle = "#594c35"; previewContext.font = "4px sans-serif";
      previewContext.fillText(String(item.text || "").slice(0, 18), (item.x + .01) * previewCanvas.width, (item.y + .035) * previewCanvas.height, (item.width - .02) * previewCanvas.width);
    });
  }

  function renderPageThumbnails() {
    document.querySelectorAll("[data-page-preview-id]").forEach(previewCanvas => {
      drawPageThumbnail(previewCanvas, pagePreviews.find(item => String(item.id) === previewCanvas.dataset.pagePreviewId));
    });
  }

  function renderCurrentThumbnail() {
    const currentId = app.dataset.currentPageId;
    const previewCanvas = document.querySelector(`[data-page-preview-id="${currentId}"]`);
    const data = pagePreviews.find(item => String(item.id) === currentId);
    if (data) { data.ink_data = strokes; data.text_boxes = textBoxes; data.sticky_notes = stickyNotes; }
    drawPageThumbnail(previewCanvas, data);
  }

  function renderTools() {
    const makeButton = item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool preset-tool";
      button.dataset.toolId = item.id;
      const color = document.createElement("i");
      color.style.setProperty("--tool-color", item.color);
      const label = document.createElement("span");
      label.textContent = item.name;
      button.append(color, label);
      button.addEventListener("click", () => {
        if (!panMode && !activeSpecial && activeToolId === item.id && lastToolClickId === item.id) {
          openToolSettings(item.id);
          return;
        }
        activeToolId = item.id;
        activeSpecial = null;
        selection = null;
        lastToolClickId = item.id;
        setPanMode(false);
        updateSelectionUI();
      });
      return button;
    };
    const general = document.getElementById("generalTools");
    const study = document.getElementById("studyTools");
    general.replaceChildren(...tools.filter(item => item.group === "general").map(makeButton));
    study.replaceChildren(...tools.filter(item => item.group === "study").map(makeButton));
    syncToolSelection();
  }

  function syncToolSelection() {
    document.querySelectorAll("[data-tool-id]").forEach(button => {
      const selected = !panMode && !activeSpecial && button.dataset.toolId === activeToolId;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function updateSpecialButtons() {
    ["eraser", "lasso", "text", "memo"].forEach(name => {
      document.getElementById(`${name}Button`)?.classList.toggle("active", !panMode && activeSpecial === name);
    });
    const modeLabels = {stroke: "획", area: "영역", lasso: "올가미"};
    document.getElementById("eraserModeLabel").textContent = modeLabels[eraserMode];
    const palmLabels = {auto: hasDetectedPen ? "자동 · 펜 감지" : "자동", on: "켜짐", off: "꺼짐"};
    document.getElementById("palmButton").textContent = `손바닥 · ${palmLabels[palmMode]}`;
    renderPaperObjects();
  }

  function openToolSettings(toolId) {
    settingsToolId = toolId;
    const item = tools.find(tool => tool.id === toolId);
    if (!item) return;
    document.getElementById("settingsToolName").textContent = item.name;
    const width = document.getElementById("toolWidth");
    width.value = item.width;
    document.getElementById("toolWidthValue").value = `${item.width}px`;
    const opacity = Math.round(Number(item.opacity ?? (item.kind === "highlighter" ? .32 : item.kind === "pencil" ? .72 : 1)) * 100);
    document.getElementById("toolOpacity").value = opacity;
    document.getElementById("toolOpacityValue").value = `${opacity}%`;
    document.getElementById("opacitySetting").hidden = item.group === "study";
    pendingColor = item.color;
    document.getElementById("colorSettings").hidden = Boolean(item.fixed_color);
    document.getElementById("fixedColorNotice").hidden = !item.fixed_color;
    document.getElementById("paletteCreator").hidden = true;
    newPaletteColors = [];
    renderPaletteSelect();
    renderPaletteColors();
    toolSettingsDialog.showModal();
  }

  function renderPaletteSelect() {
    const select = document.getElementById("paletteSelect");
    select.replaceChildren(...palettes.map(palette => {
      const option = document.createElement("option");
      option.value = palette.id; option.textContent = palette.name; option.selected = palette.id === activePaletteId;
      return option;
    }));
  }

  function renderPaletteColors() {
    const holder = document.getElementById("paletteColors");
    const palette = palettes.find(item => item.id === activePaletteId) || palettes[0];
    holder.replaceChildren(...(palette?.colors || []).map(color => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "color-chip"; button.style.backgroundColor = color; button.title = color;
      button.classList.toggle("selected", color.toUpperCase() === String(pendingColor).toUpperCase());
      button.addEventListener("click", () => { pendingColor = color; renderPaletteColors(); });
      return button;
    }));
  }

  function renderNewPaletteColors() {
    const holder = document.getElementById("newPaletteColors");
    holder.replaceChildren(...newPaletteColors.map((color, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "color-chip removable"; button.style.backgroundColor = color; button.title = "눌러서 삭제";
      button.addEventListener("click", () => { newPaletteColors.splice(index, 1); renderNewPaletteColors(); });
      return button;
    }));
  }

  function queuePreferencesSave() {
    clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(savePreferences, 250);
  }

  async function savePreferences() {
    try {
      const response = await fetch(app.dataset.preferencesUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
        body: JSON.stringify({tools, palettes, active_palette: activePaletteId, eraser_mode: eraserMode, palm_rejection: palmMode}),
      });
      if (!response.ok) throw new Error("preferences failed");
    } catch (error) {
      document.getElementById("saveStatus").textContent = "도구 설정 저장 실패";
    }
  }

  function setZoom(nextZoom, anchor, destination = anchor) {
    const before = paperSizer.getBoundingClientRect();
    if (!anchor) {
      const bounds = viewport.getBoundingClientRect();
      anchor = destination = {x: bounds.left + viewport.clientWidth / 2, y: bounds.top + viewport.clientHeight / 2};
    }
    const minZoom = viewFit === "page" ? .05 : Math.min(.25, zoom);
    zoom = Math.max(minZoom, Math.min(3, nextZoom));
    const width = Math.round(basePaperWidth * zoom);
    const height = Math.round(basePaperWidth * 297 / 210 * zoom);
    paperSizer.style.width = `${width}px`;
    paperSizer.style.height = `${height}px`;
    const percentage = `${Math.round(zoom * 100)}%`;
    zoomLabel.textContent = percentage;
    zoomLabel.setAttribute("aria-label", `너비 맞춤 · 현재 ${percentage}`);
    fitPageButton.setAttribute("aria-pressed", String(viewFit === "page"));
    fitPageButton.classList.toggle("active", viewFit === "page");

    const after = paperSizer.getBoundingClientRect();
    if (before.width && before.height) {
      viewport.scrollLeft += after.left + (anchor.x - before.left) * after.width / before.width - destination.x;
      viewport.scrollTop += after.top + (anchor.y - before.top) * after.height / before.height - destination.y;
    }
    if (!resizeFrame && (!canvasSized || width !== before.width || height !== before.height)) {
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resizeCanvas();
        canvasSized = true;
      });
    }
  }

  function resizePaper() {
    const style = getComputedStyle(viewport);
    basePaperWidth = Math.max(1, Math.min(794, viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const fittedZoom = Math.min(1, availableHeight / (basePaperWidth * 297 / 210));
    setZoom(viewFit === "page" ? fittedZoom : viewFit === "width" ? 1 : zoom);
    if (viewFit === "page") viewport.scrollTo(0, 0);
  }

  function updatePanCursor() {
    viewport.classList.toggle("is-pannable", panMode || spacePressed);
    viewport.classList.toggle("is-panning", Boolean(pointerPan));
  }

  function setPanMode(enabled) {
    panMode = enabled;
    panButton.setAttribute("aria-pressed", String(enabled));
    panButton.classList.toggle("active", enabled);
    syncToolSelection();
    updateSpecialButtons();
    updatePanCursor();
  }

  function canDrawWithFinger() {
    return fingerInkEnabled && (palmMode === "off" || (palmMode === "auto" && !hasDetectedPen));
  }

  function eraseStrokeAt(point) {
    const threshold = 18 / Math.max(canvas.clientWidth, 1);
    const index = strokes.findIndex(stroke => stroke.tool !== "eraser" && stroke.points?.some(candidate => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < threshold));
    if (index >= 0) { strokes.splice(index, 1); eraseChanged = true; redraw(); }
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1], xj = polygon[j][0], yj = polygon[j][1];
      const intersects = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || .000001) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function startDrawing(event) {
    activePointerId = event.pointerId;
    const point = pointFromEvent(event);
    if (activeSpecial === "text" || activeSpecial === "memo") {
      beginHistory();
      const isMemo = activeSpecial === "memo";
      const item = {id: `${isMemo ? "memo" : "text"}-${Date.now()}`, x: Math.max(0, Math.min(.72, point[0])), y: Math.max(0, Math.min(.84, point[1])), width: isMemo ? .24 : .28, height: isMemo ? .16 : .08, text: ""};
      if (isMemo) { item.color = "#FFF2A8"; stickyNotes.push(item); } else textBoxes.push(item);
      activePointerId = null; renderPaperObjects(); markChanged();
      requestAnimationFrame(() => document.querySelector(`[data-object-id="${item.id}"] textarea`)?.focus());
      return;
    }
    if (activeSpecial === "lasso") {
      const bounds = selectionBounds();
      if (bounds && point[0] >= bounds.left && point[0] <= bounds.right && point[1] >= bounds.top && point[1] <= bounds.bottom) {
        beginHistory();
        selectionMove = {start: point, state: snapshot()};
      } else {
        selection = null; updateSelectionUI(); lassoPoints = [point]; redraw();
      }
      return;
    }
    beginHistory();
    if (activeSpecial === "eraser") {
      eraseChanged = false;
      if (eraserMode === "stroke") eraseStrokeAt(point);
      else if (eraserMode === "lasso") { lassoPoints = [point]; redraw(); }
      else {
        activeStroke = {tool: "eraser", color: "#000000", width: 24, points: [point]};
        strokes.push(activeStroke); renderStroke(activeStroke);
      }
      return;
    }
    const item = currentTool();
    if (!item) return;
    activeStroke = {id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`, tool: item.kind, tool_id: item.id, color: item.color, width: Number(item.width), opacity: Number(item.opacity ?? (item.kind === "highlighter" ? .32 : item.kind === "pencil" ? .72 : 1)), points: [point]};
    if (item.study_role) activeStroke.study_role = item.study_role;
    strokes.push(activeStroke); renderStroke(activeStroke);
  }

  function continueDrawing(event) {
    if (event.pointerId !== activePointerId) return;
    const point = pointFromEvent(event);
    if (activeSpecial === "lasso" && selectionMove) {
      const dx = point[0] - selectionMove.start[0], dy = point[1] - selectionMove.start[1];
      const original = selectionMove.state;
      strokes.forEach(stroke => { if (selection.strokeIds.includes(stroke.id)) { const source = original.strokes.find(item => item.id === stroke.id); stroke.points = source.points.map(value => [value[0] + dx, value[1] + dy]); } });
      textBoxes.forEach(item => { if (selection.textIds.includes(item.id)) { const source = original.textBoxes.find(value => value.id === item.id); item.x = source.x + dx; item.y = source.y + dy; } });
      stickyNotes.forEach(item => { if (selection.noteIds.includes(item.id)) { const source = original.stickyNotes.find(value => value.id === item.id); item.x = source.x + dx; item.y = source.y + dy; } });
      renderPaperObjects(); redraw();
    }
    else if (activeSpecial === "lasso") { lassoPoints.push(point); redraw(); }
    else if (activeSpecial === "eraser" && eraserMode === "stroke") eraseStrokeAt(point);
    else if (activeSpecial === "eraser" && eraserMode === "lasso") { lassoPoints.push(point); redraw(); }
    else if (activeStroke) { activeStroke.points.push(point); redraw(); }
  }

  function stopDrawing(event) {
    if (event.pointerId !== activePointerId) return;
    if (activeSpecial === "lasso") {
      if (selectionMove) {
        selectionMove = null; markChanged();
      } else if (lassoPoints.length > 2) {
        selection = {
          strokeIds: strokes.filter(stroke => stroke.tool !== "eraser" && stroke.points?.some(point => pointInPolygon(point, lassoPoints))).map(stroke => stroke.id),
          textIds: textBoxes.filter(item => pointInPolygon([item.x + item.width / 2, item.y + item.height / 2], lassoPoints)).map(item => item.id),
          noteIds: stickyNotes.filter(item => pointInPolygon([item.x + item.width / 2, item.y + item.height / 2], lassoPoints)).map(item => item.id),
        };
        lassoPoints = []; updateSelectionUI(); redraw();
      }
      activePointerId = null;
      return;
    }
    if (activeSpecial === "eraser" && eraserMode === "lasso" && lassoPoints.length > 2) {
      const before = strokes.length;
      strokes = strokes.filter(stroke => stroke.tool === "eraser" || !stroke.points?.some(point => pointInPolygon(point, lassoPoints)));
      eraseChanged = strokes.length !== before;
      lassoPoints = [];
      redraw();
    }
    const changed = Boolean(activeStroke) || eraseChanged;
    if (!changed) undoStack.pop();
    activeStroke = null; activePointerId = null; eraseChanged = false;
    if (changed) markChanged();
  }

  function cancelTouchDrawing() {
    const drawing = touchSession?.drawing;
    if (!drawing) return;
    const {previousUndo, previousRedo, previousSelection} = drawing;
    const original = undoStack.at(-1);
    activeStroke = null;
    activePointerId = null;
    lassoPoints = [];
    selectionMove = null;
    eraseChanged = false;
    const beganHistory = redoStack !== previousRedo;
    undoStack = previousUndo;
    redoStack = previousRedo;
    selection = previousSelection;
    if (beganHistory) restoreSnapshot(original);
    else redraw();
    updateSelectionUI();
    touchSession.drawing = null;
  }

  async function goToPage(url) {
    if (!url || navigatingPage) return;
    navigatingPage = true;
    if (readOnly || await flushPage()) window.location.href = url;
    else navigatingPage = false;
  }

  function startPan(event) {
    pointerPan = {id: event.pointerId, x: event.clientX, y: event.clientY};
    updatePanCursor();
  }

  function stopPan() {
    pointerPan = null;
    updatePanCursor();
  }

  function updateTouchGesture() {
    const [a, b] = touchPointers.values();
    touchGesture = b ? {distance: distance(a, b), center: midpoint(a, b), zoom} : null;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot()); restoreSnapshot(undoStack.pop()); selection = null; updateSelectionUI(); markChanged();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot()); restoreSnapshot(redoStack.pop()); selection = null; updateSelectionUI(); markChanged();
  }

  viewport.addEventListener("pointerdown", event => {
    if (event.target.closest("button, textarea, .selection-actions")) return;
    const onPaper = event.target === canvas;
    if (event.pointerType === "touch") {
      if ((activePointerId !== null && !touchPointers.has(activePointerId)) ||
          (pointerPan && !touchPointers.has(pointerPan.id))) return;
      viewport.setPointerCapture(event.pointerId);
      if (!touchPointers.size) {
        const canEditPaper = onPaper && !panMode && !readOnly;
        const tapToPlace = canEditPaper && ["text", "memo"].includes(activeSpecial);
        touchSession = {
          origin: event, started: performance.now(), max: 1, moved: false, tapToPlace, drawing: null,
        };
        if (!canEditPaper || tapToPlace || !canDrawWithFinger()) startPan(event);
        else {
          touchSession.drawing = {previousUndo: undoStack.slice(), previousRedo: redoStack, previousSelection: selection};
          startDrawing(event);
        }
      }
      touchPointers.set(event.pointerId, event);
      touchSession.max = Math.max(touchSession.max, touchPointers.size);
      if (touchPointers.size >= 2) {
        cancelTouchDrawing();
        stopPan();
        updateTouchGesture();
      }
      return;
    }

    if (activePointerId !== null || (pointerPan && !touchPointers.has(pointerPan.id)) || touchPointers.size > 1) return;
    if (event.pointerType === "pen" && !hasDetectedPen) {
      hasDetectedPen = true;
      updateSpecialButtons();
    }
    const middleButton = event.pointerType === "mouse" && event.button === 1;
    const move = panMode || spacePressed || middleButton;
    if (!(event.button === 0 || middleButton) || (!move && (!onPaper || readOnly))) return;
    if (touchPointers.size) {
      touchPointers.clear();
      touchSession = null;
      stopPan();
    }
    event.preventDefault();
    viewport.focus({preventScroll: true});
    viewport.setPointerCapture(event.pointerId);
    if (move) startPan(event);
    else startDrawing(event);
  });

  viewport.addEventListener("pointermove", event => {
    if (touchPointers.has(event.pointerId)) {
      const previous = touchPointers.get(event.pointerId);
      if ((touchSession.origin.pointerId === event.pointerId && distance(event, touchSession.origin) > 8) ||
          distance(event, previous) > 8) touchSession.moved = true;
      touchPointers.set(event.pointerId, event);
      if (touchGesture) {
        const [a, b] = touchPointers.values();
        const center = midpoint(a, b);
        const nextDistance = distance(a, b);
        const shift = Math.hypot(center.x - touchGesture.center.x, center.y - touchGesture.center.y);
        if (touchSession.moved || shift > 5 || Math.abs(nextDistance - touchGesture.distance) > 8) {
          touchSession.moved = true;
          viewFit = null;
          setZoom(touchGesture.zoom * nextDistance / Math.max(touchGesture.distance, 1), touchGesture.center, center);
          touchGesture.center = center;
        }
        return;
      }
    }
    if (pointerPan?.id === event.pointerId) {
      if (touchSession?.tapToPlace && !touchSession.moved) return;
      viewport.scrollLeft -= event.clientX - pointerPan.x;
      viewport.scrollTop -= event.clientY - pointerPan.y;
      pointerPan.x = event.clientX;
      pointerPan.y = event.clientY;
      return;
    }
    continueDrawing(event);
  });

  function finishPointer(event) {
    if (pointerPan?.id === event.pointerId) stopPan();
    if (!touchPointers.delete(event.pointerId)) {
      stopDrawing(event);
      return;
    }
    const completed = event.type === "pointerup";
    if (completed) stopDrawing(event);
    else { touchSession.moved = true; cancelTouchDrawing(); }
    if (touchPointers.size >= 2) updateTouchGesture();
    else if (touchGesture) {
      touchGesture = null;
      if (touchPointers.size && touchSession.moved) startPan(touchPointers.values().next().value);
    }
    if (!touchPointers.size) {
      const {started, max, moved, tapToPlace} = touchSession;
      touchSession = null;
      if (!completed) return;
      if (max === 1) {
        if (tapToPlace && !moved) startDrawing(event);
      } else if (!moved && !readOnly && performance.now() - started < 350) {
        if (max === 2) undo();
        else redo();
      }
    }
  }
  viewport.addEventListener("pointerup", finishPointer);
  viewport.addEventListener("pointercancel", finishPointer);
  viewport.addEventListener("lostpointercapture", finishPointer);

  document.getElementById("eraserButton").addEventListener("click", () => {
    if (!panMode && activeSpecial === "eraser") {
      eraserDialog.querySelector(`[name=eraser_mode][value="${eraserMode}"]`).checked = true;
      eraserDialog.showModal();
    } else { activeSpecial = "eraser"; selection = null; lastToolClickId = null; setPanMode(false); updateSelectionUI(); }
  });
  ["lasso", "text", "memo"].forEach(name => {
    document.getElementById(`${name}Button`).addEventListener("click", () => {
      activeSpecial = name; lastToolClickId = null;
      if (name !== "lasso") selection = null;
      setPanMode(false); updateSelectionUI(); redraw();
    });
  });
  document.getElementById("copySelection").addEventListener("click", () => {
    if (!selection) return;
    beginHistory();
    const next = {strokeIds: [], textIds: [], noteIds: []};
    strokes.filter(item => selection.strokeIds.includes(item.id)).forEach(source => {
      const copy = clone(source); copy.id = `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`; copy.points = copy.points.map(point => [point[0] + .025, point[1] + .025]); strokes.push(copy); next.strokeIds.push(copy.id);
    });
    textBoxes.filter(item => selection.textIds.includes(item.id)).forEach(source => { const copy = {...clone(source), id: `text-${Date.now()}-${Math.random().toString(16).slice(2)}`, x: source.x + .025, y: source.y + .025}; textBoxes.push(copy); next.textIds.push(copy.id); });
    stickyNotes.filter(item => selection.noteIds.includes(item.id)).forEach(source => { const copy = {...clone(source), id: `memo-${Date.now()}-${Math.random().toString(16).slice(2)}`, x: source.x + .025, y: source.y + .025}; stickyNotes.push(copy); next.noteIds.push(copy.id); });
    selection = next; updateSelectionUI(); redraw(); markChanged();
  });
  document.getElementById("deleteSelection").addEventListener("click", () => {
    if (!selection) return;
    beginHistory();
    strokes = strokes.filter(item => !selection.strokeIds.includes(item.id));
    textBoxes = textBoxes.filter(item => !selection.textIds.includes(item.id));
    stickyNotes = stickyNotes.filter(item => !selection.noteIds.includes(item.id));
    selection = null; updateSelectionUI(); redraw(); markChanged();
  });
  document.getElementById("clearSelection").addEventListener("click", () => { selection = null; updateSelectionUI(); redraw(); });
  document.getElementById("saveEraserSettings").addEventListener("click", () => {
    eraserMode = eraserDialog.querySelector("[name=eraser_mode]:checked")?.value || "stroke";
    updateSpecialButtons(); queuePreferencesSave(); eraserDialog.close();
  });
  document.getElementById("undoButton").addEventListener("click", undo);
  document.getElementById("redoButton").addEventListener("click", redo);
  panButton.addEventListener("click", () => setPanMode(!panMode));
  const fingerInkButton = document.getElementById("fingerInkButton");
  fingerInkButton?.addEventListener("click", () => {
    fingerInkEnabled = !fingerInkEnabled;
    if (fingerInkEnabled) setPanMode(false);
    fingerInkButton.setAttribute("aria-pressed", String(fingerInkEnabled));
    fingerInkButton.classList.toggle("active", fingerInkEnabled);
  });
  zoomLabel.addEventListener("click", () => { viewFit = "width"; resizePaper(); });
  fitPageButton.addEventListener("click", () => { viewFit = viewFit === "page" ? "width" : "page"; resizePaper(); });
  document.getElementById("zoomOutButton").addEventListener("click", () => { viewFit = null; setZoom(zoom / 1.2); });
  document.getElementById("zoomInButton").addEventListener("click", () => { viewFit = null; setZoom(zoom * 1.2); });
  viewport.addEventListener("wheel", event => {
    if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    viewFit = null;
    setZoom(zoom * Math.exp(-delta * .002), {x: event.clientX, y: event.clientY});
  }, {passive: false});

  document.getElementById("previousPageButton").addEventListener("click", () => goToPage(app.dataset.previousPageUrl));
  document.getElementById("nextPageButton").addEventListener("click", () => goToPage(app.dataset.nextPageUrl));
  app.addEventListener("click", event => {
    const control = event.target.closest(".view-controls button, .preset-tool, [data-special-tool]");
    if (event.detail && control && document.activeElement === control) viewport.focus({preventScroll: true});
  });
  drawer.querySelectorAll("a.page-link").forEach(link => link.addEventListener("click", event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!link.classList.contains("active")) goToPage(link.href);
    else if (narrowScreen.matches) { setDrawer(false); drawerButton.focus(); }
  }));

  document.getElementById("palmButton").addEventListener("click", () => {
    palmMode = palmMode === "auto" ? "on" : palmMode === "on" ? "off" : "auto";
    updateSpecialButtons(); queuePreferencesSave();
  });
  document.getElementById("toolWidth").addEventListener("input", event => { document.getElementById("toolWidthValue").value = `${event.target.value}px`; });
  document.getElementById("toolOpacity").addEventListener("input", event => { document.getElementById("toolOpacityValue").value = `${event.target.value}%`; });
  document.getElementById("paletteSelect").addEventListener("change", event => { activePaletteId = event.target.value; renderPaletteColors(); });
  document.getElementById("showPaletteCreator").addEventListener("click", () => { document.getElementById("paletteCreator").hidden = false; newPaletteColors = []; renderNewPaletteColors(); });
  document.getElementById("addPaletteColor").addEventListener("click", () => { newPaletteColors.push(document.getElementById("newPaletteColor").value.toUpperCase()); renderNewPaletteColors(); });
  document.getElementById("savePaletteButton").addEventListener("click", () => {
    const name = document.getElementById("newPaletteName").value.trim();
    if (!name || !newPaletteColors.length) return;
    const id = `custom-${Date.now()}`;
    palettes.push({id, name, colors: [...newPaletteColors], built_in: false});
    activePaletteId = id; document.getElementById("paletteCreator").hidden = true;
    renderPaletteSelect(); renderPaletteColors(); queuePreferencesSave();
  });
  document.getElementById("saveToolSettings").addEventListener("click", () => {
    const item = tools.find(tool => tool.id === settingsToolId);
    if (!item) return;
    item.width = Number(document.getElementById("toolWidth").value);
    if (item.group === "general") item.opacity = Number(document.getElementById("toolOpacity").value) / 100;
    if (!item.fixed_color && pendingColor) item.color = pendingColor;
    renderTools(); queuePreferencesSave(); toolSettingsDialog.close();
  });

  document.getElementById("addToolButton").addEventListener("click", () => newToolDialog.showModal());
  document.getElementById("createToolButton").addEventListener("click", () => {
    const name = document.getElementById("newToolName").value.trim();
    const kind = document.getElementById("newToolKind").value;
    if (!name) return;
    const palette = palettes.find(item => item.id === activePaletteId) || palettes[0];
    const item = {id: `custom-tool-${Date.now()}`, name, kind, color: palette?.colors?.[0] || "#343A40", width: kind === "highlighter" ? 18 : 3, opacity: kind === "highlighter" ? .32 : kind === "pencil" ? .72 : 1, group: "general"};
    tools.push(item); activeToolId = item.id; activeSpecial = null;
    lastToolClickId = item.id;
    document.getElementById("newToolName").value = "";
    newToolDialog.close(); renderTools(); queuePreferencesSave(); openToolSettings(item.id);
  });

  const paperTemplatesDialog = document.getElementById("paperTemplatesDialog");
  if (paperTemplatesDialog) {
    const trigger = document.getElementById("openPaperTemplates");
    const swatch = document.getElementById("currentPaperSwatch");
    const uploadForm = document.getElementById("uploadPaper");
    const options = paperTemplatesDialog.querySelectorAll(".template-tile");
    trigger.addEventListener("click", () => {
      options.forEach(option => option.setAttribute("aria-pressed", String(option.value === paper.dataset.template)));
      paperTemplatesDialog.showModal();
      paperTemplatesDialog.querySelector('[aria-pressed="true"]')?.focus();
    });
    uploadForm.addEventListener("submit", async event => {
      event.preventDefault();
      const button = uploadForm.querySelector("button");
      button.disabled = true;
      const saved = await flushPage();
      if (saved) uploadForm.submit();
      else button.disabled = false;
    });
    options.forEach(option => option.addEventListener("click", () => {
      paperTemplatesDialog.close();
      if (option.value === paper.dataset.template) return;
      const previousClass = `paper-${paper.dataset.template}`;
      const nextClass = `paper-${option.value}`;
      const thumbnail = document.querySelector(`[data-page-preview-id="${app.dataset.currentPageId}"]`);
      if (thumbnail && option.value === "custom") thumbnail.style.setProperty("--paper-image", paper.style.getPropertyValue("--paper-image"));
      [paper, swatch, thumbnail].forEach(element => element?.classList.replace(previousClass, nextClass));
      paper.dataset.template = option.value;
      trigger.title = `현재 속지: ${option.getAttribute("aria-label")}`;
      markChanged();
    }));
  }
  document.querySelectorAll("[data-add-page]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    if (navigatingPage) return;
    navigatingPage = true;
    const button = form.querySelector("button");
    button.disabled = true;
    if (await flushPage()) form.submit();
    else {
      button.disabled = false;
      navigatingPage = false;
    }
  }));
  document.getElementById("pageTitle").addEventListener("input", markChanged);

  const recognitionDialog = document.getElementById("recognitionDialog");
  const recognizeButton = document.getElementById("recognizeButton");
  recognizeButton.parentElement.prepend(recognizeButton);
  const recognitionNotice = document.getElementById("recognitionNotice");
  const recognizedInput = document.getElementById("recognizedText");
  const quizTermsInput = document.getElementById("quizTerms");
  const inkPreview = document.getElementById("inkPreview");
  const positions = document.getElementById("recognitionPositions");
  const initialRecognitionNotice = recognitionNotice.innerHTML;
  let savedRecognition = {
    text: recognizedInput.value,
    terms: quizTermsInput.value,
    blocks: JSON.parse(document.getElementById("recognition-blocks").textContent),
    uncertain: JSON.parse(document.getElementById("recognition-uncertain").textContent),
  };
  let recognitionDraft = null;
  let recognitionRequest = null;
  let savingRecognition = false;
  function showRecognitionPositions() {
    positions.replaceChildren();
    inkPreview.replaceChildren();
    const edited = recognizedInput.value.split("\n");
    if (!recognitionDraft || edited.length !== recognitionDraft.blocks.length) return;
    const uncertain = new Set(recognitionDraft.uncertain.map(bounds => bounds.join()));
    recognitionDraft.blocks.forEach(({bounds}, index) => {
      const [left, top, right, bottom] = bounds;
      const area = document.createElement("span");
      area.className = "ocr-area";
      area.classList.toggle("uncertain", uncertain.has(bounds.join()));
      area.style.cssText = `left:${left * 100}%;top:${top * 100}%;width:${(right-left) * 100}%;height:${(bottom-top) * 100}%`;
      inkPreview.append(area);
      const label = area.cloneNode();
      label.textContent = edited[index];
      label.title = edited[index];
      positions.append(label);
    });
  }
  recognizedInput.addEventListener("input", showRecognitionPositions);

  async function requestRecognition(imageData, selection = false, signal) {
    const response = await fetch(app.dataset.recognizeUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
      body: JSON.stringify({image_data: imageData, selection}),
      signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "손글씨 인식에 실패했어요.");
    return result;
  }

  document.getElementById("convertSelection").addEventListener("click", async event => {
    if (!selection?.strokeIds.length) return;
    const button = event.currentTarget;
    const {left, top, right, bottom} = selectionBounds();
    const bounds = [Math.max(0, left - .02), Math.max(0, top - .02), Math.min(1, right + .02), Math.min(1, bottom + .02)];
    const selectedInk = strokes.filter(stroke => selection.strokeIds.includes(stroke.id));
    const crop = document.createElement("canvas");
    drawPageInk(crop, selectedInk, bounds);
    const ctx = crop.getContext("2d");
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, crop.width, crop.height);
    button.disabled = true;
    button.textContent = "인식 중…";
    try {
      const {recognized_text: text} = await requestRecognition(crop.toDataURL("image/png"), true);
      const width = Math.min(.9, Math.max(.2, right - left));
      const height = Math.min(.45, Math.max(.07, bottom - top, text.split("\n").length * .03));
      beginHistory();
      textBoxes.push({id: `text-${newRecordId()}`, text, x: Math.max(0, Math.min(left, 1 - width)), y: Math.max(0, Math.min(bottom + .018, 1 - height)), width, height});
      selection = null;
      activeSpecial = "text";
      syncToolSelection();
      updateSpecialButtons();
      updateSelectionUI();
      redraw();
      markChanged();
    } catch (error) {
      document.getElementById("saveStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "텍스트로 변환";
    }
  });
  function recognitionImageData() {
    const exportCanvas = document.createElement("canvas");
    const scale = Math.min(1, 2100 / Math.max(canvas.width, canvas.height));
    exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
    exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));
    const exportContext = exportCanvas.getContext("2d");
    exportContext.fillStyle = "#ffffff";
    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportContext.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    return exportCanvas.toDataURL("image/png");
  }
  const rerunRecognition = document.getElementById("rerunRecognition");
  const confirmRecognition = document.getElementById("confirmRecognition");
  const recognitionCloseButtons = recognitionDialog.querySelectorAll('[value="cancel"], [data-close-recognition]');

  function updateRecognitionControls() {
    rerunRecognition.disabled = confirmRecognition.disabled = Boolean(recognitionRequest) || savingRecognition;
    recognizedInput.disabled = quizTermsInput.disabled = savingRecognition;
    recognitionCloseButtons.forEach(button => { button.disabled = savingRecognition; });
  }

  function discardRecognitionDraft() {
    recognitionRequest?.abort();
    recognitionRequest = null;
    recognitionDraft = null;
    recognizedInput.value = savedRecognition.text;
    quizTermsInput.value = savedRecognition.terms;
    updateRecognitionControls();
  }

  async function runRecognition(imageData) {
    inkPreview.style.backgroundImage = `url(${imageData})`;
    if (!strokes.length) {
      recognitionNotice.innerHTML = "<strong>필기 없음:</strong> 먼저 종이에 손글씨를 작성해 주세요.";
      return;
    }
    const controller = new AbortController();
    recognitionRequest = controller;
    updateRecognitionControls();
    recognitionNotice.innerHTML = "<strong>서버에서 인식 중:</strong> 손글씨를 읽고 있어요. 첫 실행은 모델을 준비하느라 조금 더 걸릴 수 있어요.";
    try {
      const result = await requestRecognition(imageData, false, controller.signal);
      if (recognitionRequest !== controller || !recognitionDialog.open) return;
      recognizedInput.value = result.recognized_text;
      recognitionDraft = {
        blocks: result.blocks,
        uncertain: result.blocks.filter(block => block.confidence < .55).map(block => block.bounds),
        token: result.recognition_token,
      };
      showRecognitionPositions();
      recognitionNotice.innerHTML = "<strong>로컬 인식 완료:</strong> 잘못 읽힌 부분이 없는지 확인하고 수정해 주세요.";
    } catch (error) {
      if (recognitionRequest === controller && recognitionDialog.open) recognitionNotice.textContent = `자동 인식 실패: ${error.message}`;
    } finally {
      if (recognitionRequest === controller) {
        recognitionRequest = null;
        updateRecognitionControls();
      }
    }
  }
  recognizeButton.addEventListener("click", () => {
    discardRecognitionDraft();
    recognitionDraft = {blocks: savedRecognition.blocks, uncertain: savedRecognition.uncertain};
    recognitionNotice.innerHTML = initialRecognitionNotice;
    const imageData = recognitionImageData();
    inkPreview.style.backgroundImage = `url(${imageData})`;
    showRecognitionPositions();
    recognitionDialog.showModal();
    if (!recognitionDraft.blocks.length && !savedRecognition.text) runRecognition(imageData);
  });
  rerunRecognition.addEventListener("click", () => runRecognition(recognitionImageData()));
  document.querySelector("[data-close-recognition]").addEventListener("click", () => recognitionDialog.close());
  recognitionDialog.addEventListener("cancel", event => { if (savingRecognition) event.preventDefault(); });
  recognitionDialog.addEventListener("close", () => {
    if (!recognitionDialog.open) discardRecognitionDraft();
  });
  confirmRecognition.addEventListener("click", async () => {
    savingRecognition = true;
    updateRecognitionControls();
    const review = {
      recognition_reviewed: true,
      recognized_text: recognizedInput.value,
      quiz_terms: quizTermsInput.value.split(/[,\n]/).map(value => value.trim()).filter(Boolean),
      recognition_token: recognitionDraft.token,
    };
    const saved = await savePage(review);
    savingRecognition = false;
    updateRecognitionControls();
    if (saved) {
      savedRecognition = {text: saved.recognized_text, terms: saved.quiz_terms.join(", "), blocks: saved.blocks, uncertain: []};
      recognitionDialog.close();
    } else {
      recognitionNotice.textContent = "인식 결과를 저장하지 못했어요. 다시 시도해 주세요.";
    }
  });

  function savePage(review = null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    pendingSave = pendingSave.then(() => persistPage(review));
    return pendingSave;
  }

  async function flushPage() {
    const saved = await (saveTimer ? savePage() : pendingSave);
    return saved || savePage();
  }

  async function persistPage(review) {
    const status = document.getElementById("saveStatus"); status.textContent = "저장 중…";
    try {
      const response = await fetch(app.dataset.saveUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
        body: JSON.stringify({
          title: document.getElementById("pageTitle").value,
          ink_data: strokes, text_boxes: textBoxes, sticky_notes: stickyNotes, text_content: "",
          paper_template: paper.dataset.template,
          ...review,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      const saved = await response.json();
      status.textContent = "저장됨";
      return saved;
    } catch (error) {
      status.textContent = "저장 실패 · 다시 시도";
      return false;
    }
  }

  window.addEventListener("keydown", event => {
    if (event.code === "Space" && !event.target.matches("input,textarea,select,button,a,summary,[contenteditable]") && !event.target.closest("dialog")) {
      spacePressed = true;
      updatePanCursor();
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });
  window.addEventListener("keyup", event => { if (event.code === "Space") { spacePressed = false; updatePanCursor(); } });
  window.addEventListener("blur", () => { spacePressed = false; updatePanCursor(); });
  window.addEventListener("beforeunload", () => { if (saveTimer) savePage(); if (preferenceTimer) savePreferences(); });

  document.querySelectorAll(".chapter-toggle").forEach(button => {
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.getAttribute("aria-controls"));
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
      button.querySelector("b").textContent = willOpen ? "−" : "+";
    });
  });

  document.querySelectorAll("[data-title-edit-target]").forEach(titleButton => {
    titleButton.addEventListener("click", () => {
      const form = document.getElementById(titleButton.dataset.titleEditTarget);
      titleButton.hidden = true;
      form.hidden = false;
      const input = form.querySelector('input[name="title"]');
      input.focus(); input.select();
    });
  });
  document.querySelectorAll("[data-title-edit-form]").forEach(form => {
    const titleButton = document.querySelector(`[data-title-edit-target="${form.id}"]`);
    const closeEditor = () => { form.reset(); form.hidden = true; titleButton.hidden = false; };
    form.querySelector("[data-title-edit-cancel]").addEventListener("click", closeEditor);
    form.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); closeEditor(); } });
  });

  renderTools(); updateSpecialButtons(); renderPageThumbnails(); resizePaper();
  new ResizeObserver(resizePaper).observe(viewport, {box: "border-box"});
})();
