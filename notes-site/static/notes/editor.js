(() => {
  const app = document.getElementById("editorApp");
  if (!app) return;

  const canvas = document.getElementById("inkCanvas");
  const paper = document.getElementById("paper");
  const paperSizer = document.getElementById("paperSizer");
  const viewport = document.getElementById("paperViewport");
  const context = canvas.getContext("2d");
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
  let saving = false;
  let saveQueued = false;
  let zoom = 1;
  let basePaperWidth = 794;
  let spacePressed = false;
  let mousePan = null;
  let hasDetectedPen = false;
  const touchPointers = new Map();
  let touchGesture = null;
  let touchTap = null;
  let pageSwipe = null;
  let marginSwipe = null;
  let navigatingPage = false;
  let selection = null;
  let selectionMove = null;
  let objectDrag = null;

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
    const ratio = window.devicePixelRatio || 1;
    const rect = paper.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function renderStroke(stroke) {
    if (!stroke.points || stroke.points.length < 1) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Number(stroke.width) || 2;
    context.strokeStyle = stroke.color || "#343A40";
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
    previewContext.globalAlpha = Number.isFinite(Number(stroke.opacity)) ? Number(stroke.opacity) : fallbackOpacity;
    previewContext.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    previewContext.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point[0] * previewCanvas.width;
      const y = point[1] * previewCanvas.height;
      if (index === 0) previewContext.moveTo(x, y); else previewContext.lineTo(x, y);
    });
    previewContext.stroke();
    previewContext.restore();
  }

  function drawPageThumbnail(previewCanvas, data) {
    if (!previewCanvas || !data) return;
    const previewContext = previewCanvas.getContext("2d");
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.fillStyle = data.paper_template === "hanji" ? "#f8f1dc" : "#ffffff";
    previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.save();
    previewContext.strokeStyle = "#dce4e8";
    previewContext.lineWidth = .5;
    if (data.paper_template === "lined") {
      for (let y = 10; y < previewCanvas.height; y += 10) { previewContext.beginPath(); previewContext.moveTo(0, y); previewContext.lineTo(previewCanvas.width, y); previewContext.stroke(); }
    } else if (data.paper_template === "grid") {
      for (let y = 8; y < previewCanvas.height; y += 8) { previewContext.beginPath(); previewContext.moveTo(0, y); previewContext.lineTo(previewCanvas.width, y); previewContext.stroke(); }
      for (let x = 8; x < previewCanvas.width; x += 8) { previewContext.beginPath(); previewContext.moveTo(x, 0); previewContext.lineTo(x, previewCanvas.height); previewContext.stroke(); }
    }
    previewContext.restore();
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
    if (data) { data.ink_data = strokes; data.text_boxes = textBoxes; data.sticky_notes = stickyNotes; data.paper_template = document.getElementById("paperTemplate").value; }
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
        if (!activeSpecial && activeToolId === item.id && lastToolClickId === item.id) {
          openToolSettings(item.id);
          return;
        }
        activeToolId = item.id;
        activeSpecial = null;
        selection = null;
        lastToolClickId = item.id;
        syncToolSelection();
        updateSpecialButtons();
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
      button.classList.toggle("active", !activeSpecial && button.dataset.toolId === activeToolId);
      button.setAttribute("aria-pressed", String(!activeSpecial && button.dataset.toolId === activeToolId));
    });
  }

  function updateSpecialButtons() {
    ["eraser", "lasso", "text", "memo"].forEach(name => {
      document.getElementById(`${name}Button`)?.classList.toggle("active", activeSpecial === name);
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

  function setZoom(nextZoom, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) {
    const clamped = Math.max(.5, Math.min(3, nextZoom));
    const ratio = clamped / zoom;
    const beforeLeft = viewport.scrollLeft;
    const beforeTop = viewport.scrollTop;
    zoom = clamped;
    paperSizer.style.width = `${Math.round(basePaperWidth * zoom)}px`;
    paperSizer.style.height = `${Math.round(basePaperWidth * 297 / 210 * zoom)}px`;
    document.getElementById("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
    requestAnimationFrame(() => {
      resizeCanvas();
      viewport.scrollLeft = (beforeLeft + clientX) * ratio - clientX;
      viewport.scrollTop = (beforeTop + clientY) * ratio - clientY;
    });
  }

  function shouldRejectTouchDrawing(event) {
    if (event.pointerType !== "touch") return false;
    return palmMode === "on" || (palmMode === "auto" && hasDetectedPen);
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
    if (app.dataset.readonly === "true" || shouldRejectTouchDrawing(event)) return;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
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

  function cancelStrokeForGesture() {
    if (activePointerId === null) return;
    const shouldDiscardHistory = Boolean(activeStroke || selectionMove || activeSpecial === "eraser");
    if (activeStroke && strokes.at(-1) === activeStroke) strokes.pop();
    if (shouldDiscardHistory && undoStack.length) undoStack.pop();
    activeStroke = null; activePointerId = null; lassoPoints = []; selectionMove = null; eraseChanged = false; redraw();
  }

  async function goToAdjacentPage(direction) {
    if (navigatingPage) return;
    const url = direction === "next" ? app.dataset.nextPageUrl : app.dataset.previousPageUrl;
    if (!url) {
      document.getElementById("saveStatus").textContent = direction === "next" ? "마지막 페이지" : "첫 페이지";
      return;
    }
    navigatingPage = true;
    clearTimeout(saveTimer);
    await savePage();
    window.location.href = url;
  }

  function completeHorizontalSwipe(swipe) {
    if (!swipe) return false;
    const dx = swipe.lastX - swipe.startX;
    const dy = swipe.lastY - swipe.startY;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.35) return false;
    goToAdjacentPage(dx < 0 ? "next" : "previous");
    return true;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot()); restoreSnapshot(undoStack.pop()); selection = null; updateSelectionUI(); markChanged();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot()); restoreSnapshot(redoStack.pop()); selection = null; updateSelectionUI(); markChanged();
  }

  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType === "pen") { hasDetectedPen = true; updateSpecialButtons(); }
    if (event.pointerType === "touch") {
      touchPointers.set(event.pointerId, event);
      if (hasDetectedPen && palmMode !== "off" && touchPointers.size === 1) {
        pageSwipe = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY};
      }
      if (!touchTap) touchTap = {start: performance.now(), max: 0, moved: false};
      touchTap.max = Math.max(touchTap.max, touchPointers.size);
      if (touchPointers.size === 2) {
        cancelStrokeForGesture();
        pageSwipe = null;
        const [a, b] = [...touchPointers.values()];
        touchGesture = {distance: distance(a, b), zoom, center: midpoint(a, b), scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop};
        return;
      }
      if (touchPointers.size > 1) return;
    }
    if (spacePressed && event.pointerType === "mouse") {
      mousePan = {x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop};
      canvas.setPointerCapture(event.pointerId); return;
    }
    startDrawing(event);
  });

  canvas.addEventListener("pointermove", event => {
    if (mousePan) {
      viewport.scrollLeft = mousePan.left - (event.clientX - mousePan.x);
      viewport.scrollTop = mousePan.top - (event.clientY - mousePan.y);
      return;
    }
    if (event.pointerType === "touch" && touchPointers.has(event.pointerId)) {
      const previous = touchPointers.get(event.pointerId);
      if (Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) > 8 && touchTap) touchTap.moved = true;
      touchPointers.set(event.pointerId, event);
      if (pageSwipe?.pointerId === event.pointerId && touchPointers.size === 1) {
        pageSwipe.lastX = event.clientX; pageSwipe.lastY = event.clientY;
        if (Math.hypot(pageSwipe.lastX - pageSwipe.startX, pageSwipe.lastY - pageSwipe.startY) > 8 && touchTap) touchTap.moved = true;
        return;
      }
      if (touchPointers.size >= 2 && touchGesture) {
        const [a, b] = [...touchPointers.values()];
        const center = midpoint(a, b);
        setZoom(touchGesture.zoom * distance(a, b) / Math.max(touchGesture.distance, 1), center.x - viewport.getBoundingClientRect().left, center.y - viewport.getBoundingClientRect().top);
        viewport.scrollLeft -= center.x - touchGesture.center.x;
        viewport.scrollTop -= center.y - touchGesture.center.y;
        touchGesture.center = center;
        touchTap.moved = true;
        return;
      }
    }
    continueDrawing(event);
  });

  function finishPointer(event) {
    if (mousePan) { mousePan = null; return; }
    stopDrawing(event);
    if (event.pointerType === "touch") {
      const completedPageSwipe = pageSwipe?.pointerId === event.pointerId ? {...pageSwipe, lastX: event.clientX, lastY: event.clientY} : null;
      touchPointers.delete(event.pointerId);
      if (!touchPointers.size) {
        if (touchTap && !touchTap.moved && performance.now() - touchTap.start < 350) {
          if (touchTap.max === 2) undo();
          if (touchTap.max >= 3) redo();
        }
        touchGesture = null; touchTap = null;
      }
      if (completedPageSwipe) completeHorizontalSwipe(completedPageSwipe);
      if (pageSwipe?.pointerId === event.pointerId) pageSwipe = null;
    }
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);

  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || event.target.closest("#paperSizer") || event.target.closest(".text-panel")) return;
    marginSwipe = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", event => {
    if (marginSwipe?.pointerId !== event.pointerId) return;
    marginSwipe.lastX = event.clientX; marginSwipe.lastY = event.clientY;
  });
  const finishMarginSwipe = event => {
    if (marginSwipe?.pointerId !== event.pointerId) return;
    marginSwipe.lastX = event.clientX; marginSwipe.lastY = event.clientY;
    completeHorizontalSwipe(marginSwipe); marginSwipe = null;
  };
  viewport.addEventListener("pointerup", finishMarginSwipe);
  viewport.addEventListener("pointercancel", () => { marginSwipe = null; });

  document.getElementById("eraserButton").addEventListener("click", () => {
    if (activeSpecial === "eraser") {
      eraserDialog.querySelector(`[name=eraser_mode][value="${eraserMode}"]`).checked = true;
      eraserDialog.showModal();
    } else { activeSpecial = "eraser"; selection = null; lastToolClickId = null; syncToolSelection(); updateSpecialButtons(); updateSelectionUI(); }
  });
  ["lasso", "text", "memo"].forEach(name => {
    document.getElementById(`${name}Button`).addEventListener("click", () => {
      activeSpecial = name; lastToolClickId = null;
      if (name !== "lasso") selection = null;
      syncToolSelection(); updateSpecialButtons(); updateSelectionUI(); redraw();
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
  document.getElementById("zoomOutButton").addEventListener("click", () => setZoom(zoom - .1));
  document.getElementById("zoomInButton").addEventListener("click", () => setZoom(zoom + .1));
  viewport.addEventListener("wheel", event => { if (event.target.closest(".text-panel")) return; event.preventDefault(); const rect = viewport.getBoundingClientRect(); setZoom(zoom * (event.deltaY < 0 ? 1.1 : .9), event.clientX - rect.left, event.clientY - rect.top); }, {passive: false});

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

  document.getElementById("paperTemplate").addEventListener("change", event => { paper.className = `note-paper paper-${event.target.value}`; markChanged(); });
  document.getElementById("pageTitle").addEventListener("input", markChanged);

  const recognitionDialog = document.getElementById("recognitionDialog");
  document.getElementById("recognizeButton").addEventListener("click", () => { document.getElementById("inkPreview").style.backgroundImage = `url(${canvas.toDataURL("image/png")})`; recognitionDialog.showModal(); });
  document.querySelector("[data-close-recognition]").addEventListener("click", () => recognitionDialog.close());
  document.getElementById("confirmRecognition").addEventListener("click", async () => { await savePage(true); recognitionDialog.close(); });

  function terms() { return document.getElementById("quizTerms").value.split(/[,\n]/).map(value => value.trim()).filter(Boolean); }
  async function savePage(reviewed = false) {
    if (saving) { saveQueued = true; return; }
    saving = true; saveQueued = false;
    const status = document.getElementById("saveStatus"); status.textContent = "저장 중…";
    try {
      const response = await fetch(app.dataset.saveUrl, {method: "POST", headers: {"Content-Type": "application/json", "X-CSRFToken": csrf}, body: JSON.stringify({title: document.getElementById("pageTitle").value, ink_data: strokes, text_boxes: textBoxes, sticky_notes: stickyNotes, text_content: "", recognized_text: document.getElementById("recognizedText").value, quiz_terms: terms(), paper_template: document.getElementById("paperTemplate").value, recognition_reviewed: reviewed})});
      if (!response.ok) throw new Error("save failed");
      status.textContent = "저장됨";
    } catch (error) { status.textContent = "저장 실패 · 다시 시도"; }
    finally { saving = false; if (saveQueued) savePage(); }
  }

  window.addEventListener("keydown", event => {
    if (event.code === "Space" && !event.target.matches("input,textarea,select")) { spacePressed = true; canvas.classList.add("is-pannable"); event.preventDefault(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });
  window.addEventListener("keyup", event => { if (event.code === "Space") { spacePressed = false; mousePan = null; canvas.classList.remove("is-pannable"); } });
  window.addEventListener("resize", () => { if (zoom === 1) { basePaperWidth = Math.min(794, Math.max(320, viewport.clientWidth - 52)); setZoom(1); } else resizeCanvas(); });
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

  basePaperWidth = Math.min(794, Math.max(320, viewport.clientWidth - 52));
  renderTools(); updateSpecialButtons(); renderPageThumbnails(); setZoom(1);
})();
