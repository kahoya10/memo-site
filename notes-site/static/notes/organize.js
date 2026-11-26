(() => {
  const app = document.getElementById("organizeApp");
  const source = JSON.parse(document.getElementById("organize-source").textContent);
  const byId = new Map(source.map(page => [page.id, page]));
  const items = JSON.parse(document.getElementById("organize-items").textContent).filter(item => byId.has(item.page));
  const form = document.getElementById("organizeForm");
  const search = document.getElementById("sourceSearch");
  const unit = document.getElementById("sourceUnit");
  const results = document.getElementById("sourceResults");
  const empty = document.getElementById("organizeEmpty");
  const status = document.getElementById("organizeStatus");
  const mapBoard = document.getElementById("mapBoard");
  const mapNodes = document.getElementById("mapNodes");
  const detail = document.getElementById("mapDetail");
  let selected = null;
  let dragged = null;
  let dirty = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label, action) {
    const node = element("button", label, "small-button");
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function itemTitle(item) {
    const page = byId.get(item.page);
    return item.paragraph === null ? page.title : (page.paragraphs[item.paragraph] || page.title);
  }
  function preview(item) {
    const page = byId.get(item.page);
    const group = element("div", null, "organize-preview");
    if (item.paragraph === null && page.ink.length) {
      const canvas = element("canvas", null, `paper-${page.paper}`);
      if (page.paper_url) canvas.style.setProperty("--paper-image", `url("${page.paper_url}")`);
      canvas.setAttribute("aria-label", `${page.title} 필기`);
      drawPageInk(canvas, page.ink);
      group.append(canvas);
    }
    const text = item.paragraph === null ? page.paragraphs.join("\n\n") : page.paragraphs[item.paragraph];
    if (text) group.append(element("p", text));
    return group;
  }
  function changed() {
    dirty = true;
    status.textContent = "저장 대기";
  }
  function add(page, paragraph, at = null) {
    if (items.length >= 100) { status.textContent = "보기 하나에는 100개까지 넣을 수 있어요."; return; }
    const item = {id: newRecordId(), page, paragraph};
    if (mapBoard) {
      const angle = items.length * 2.4;
      Object.assign(item, at || {x: 50 + 32 * Math.cos(angle), y: 50 + 32 * Math.sin(angle)}, {parent: null});
      selected = item.id;
    }
    items.push(item);
    changed();
    render();
  }
  function remove(index) {
    const [item] = items.splice(index, 1);
    items.forEach(other => { if (other.parent === item.id) other.parent = null; });
    if (selected === item.id) selected = null;
    changed();
    render();
  }
  function move(from, to) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    items.splice(to, 0, ...items.splice(from, 1));
    changed();
    render();
  }

  function renderSources() {
    const query = search.value.trim().toLowerCase();
    const matching = [];
    for (const page of source) {
      const heading = `${page.chapter} ${page.title}`.toLowerCase();
      if (unit.value === "paragraph") {
        page.paragraphs.forEach((text, index) => {
          if (`${heading} ${text.toLowerCase()}`.includes(query)) matching.push({page, paragraph: index, text});
        });
      } else if (`${heading} ${page.paragraphs.join(" ").toLowerCase()}`.includes(query)) {
        const excerpt = page.paragraphs.find(text => text.toLowerCase().includes(query)) || page.paragraphs[0];
        matching.push({page, paragraph: null, text: excerpt});
      }
    }
    results.replaceChildren();
    for (const {page, paragraph, text} of matching.slice(0, 100)) {
      const result = element("li");
      result.draggable = true;
      result.addEventListener("dragstart", event => {
        dragged = {page: page.id, paragraph};
        event.dataTransfer.setData("text/plain", page.title);
      });
      result.addEventListener("dragend", () => { dragged = null; });
      result.append(element("strong", page.title), element("p", text?.slice(0, 160) || page.chapter), button("가져오기", () => add(page.id, paragraph)));
      results.append(result);
    }
    if (!matching.length) results.append(element("li", "검색 결과가 없어요."));
  }

  function renderOrder() {
    const list = document.getElementById("orderedNotes");
    list.replaceChildren();
    items.forEach((item, index) => {
      const card = element("li");
      card.draggable = true;
      card.addEventListener("dragstart", event => {
        dragged = {index};
        event.dataTransfer.setData("text/plain", itemTitle(item));
      });
      card.addEventListener("dragend", () => { dragged = null; });
      card.addEventListener("dragover", event => event.preventDefault());
      card.addEventListener("drop", event => {
        if (dragged?.index === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        move(dragged.index, index);
        dragged = null;
      });
      const actions = element("div", null, "mode-buttons");
      const up = button("위로", () => move(index, index - 1));
      const down = button("아래로", () => move(index, index + 1));
      up.disabled = index === 0;
      down.disabled = index === items.length - 1;
      actions.append(up, down, button("빼기", () => remove(index)));
      card.append(element("h3", byId.get(item.page).title), preview(item), actions);
      list.append(card);
    });
  }

  function drawConnections() {
    const canvas = mapBoard.querySelector("canvas");
    canvas.width = mapBoard.clientWidth;
    canvas.height = mapBoard.clientHeight;
    const context = canvas.getContext("2d");
    context.strokeStyle = "#83968b";
    context.lineWidth = 2;
    for (const item of items) {
      const parent = items.find(other => other.id === item.parent) || {x: 50, y: 50};
      context.beginPath();
      context.moveTo(parent.x * canvas.width / 100, parent.y * canvas.height / 100);
      context.lineTo(item.x * canvas.width / 100, item.y * canvas.height / 100);
      context.stroke();
    }
  }
  function leadsTo(node, target) {
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      if (node.id === target) return true;
      seen.add(node.id);
      node = items.find(other => other.id === node.parent);
    }
    return false;
  }
  function renderMap() {
    mapNodes.replaceChildren();
    for (const item of items) {
      const node = button(itemTitle(item), () => { selected = item.id; renderMap(); });
      node.title = itemTitle(item);
      node.className = `map-node${item.id === selected ? " active" : ""}`;
      node.style.left = `${item.x}%`;
      node.style.top = `${item.y}%`;
      node.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        const origin = {x: event.clientX, y: event.clientY, itemX: item.x, itemY: item.y};
        node.setPointerCapture(event.pointerId);
        let moving = false;
        const moveNode = point => {
          const dx = point.clientX - origin.x;
          const dy = point.clientY - origin.y;
          if (!moving && Math.hypot(dx, dy) < 4) return;
          moving = true;
          item.x = Math.max(12, Math.min(88, origin.itemX + 100 * dx / mapBoard.clientWidth));
          item.y = Math.max(7, Math.min(93, origin.itemY + 100 * dy / mapBoard.clientHeight));
          node.style.left = `${item.x}%`;
          node.style.top = `${item.y}%`;
          drawConnections();
        };
        node.addEventListener("pointermove", moveNode);
        node.addEventListener("lostpointercapture", () => {
          node.removeEventListener("pointermove", moveNode);
          if (moving) changed();
        }, {once: true});
      });
      mapNodes.append(node);
    }
    drawConnections();
    const index = items.findIndex(item => item.id === selected);
    detail.hidden = index === -1;
    detail.replaceChildren();
    if (index === -1) return;
    const item = items[index];
    const parentLabel = element("label", "연결할 항목 ");
    const parents = document.createElement("select");
    parents.add(new Option("공책 제목", ""));
    items.filter(other => !leadsTo(other, item.id)).forEach(other => parents.add(new Option(itemTitle(other).slice(0, 60), other.id)));
    parents.value = item.parent || "";
    parents.addEventListener("change", () => { item.parent = parents.value || null; changed(); drawConnections(); });
    parentLabel.append(parents);
    detail.append(element("h3", byId.get(item.page).title), preview(item), parentLabel, button("빼기", () => remove(index)));
  }

  function render() {
    empty.hidden = Boolean(mapBoard) || items.length > 0;
    if (mapBoard) renderMap();
    else renderOrder();
  }
  const dropZone = mapBoard || document.querySelector(".organize-board");
  dropZone.addEventListener("dragover", event => { if (dragged) event.preventDefault(); });
  dropZone.addEventListener("drop", event => {
    if (!dragged?.page) return;
    event.preventDefault();
    const rect = dropZone.getBoundingClientRect();
    const at = mapBoard ? {x: Math.max(12, Math.min(88, (event.clientX - rect.left) * 100 / rect.width)), y: Math.max(7, Math.min(93, (event.clientY - rect.top) * 100 / rect.height))} : null;
    add(dragged.page, dragged.paragraph, at);
    dragged = null;
  });
  if (mapBoard) new ResizeObserver(drawConnections).observe(mapBoard);
  search.addEventListener("input", renderSources);
  unit.addEventListener("change", () => { renderSources(); changed(); });
  document.getElementById("viewName").addEventListener("input", changed);
  document.getElementById("savedViews").addEventListener("change", event => { location.href = event.target.value; });
  window.addEventListener("beforeunload", event => { if (dirty) event.preventDefault(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const response = await fetch(app.dataset.url, {
        method: "POST", headers: {"Content-Type": "application/json", "X-CSRFToken": form.elements.csrfmiddlewaretoken.value},
        body: JSON.stringify({id: app.dataset.view, kind: app.dataset.kind, name: document.getElementById("viewName").value, unit: unit.value, items}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      dirty = false;
      location.href = result.url;
    } catch (error) { status.textContent = error.message || "저장에 실패했어요."; }
    finally { submit.disabled = false; }
  });
  renderSources();
  render();
})();
