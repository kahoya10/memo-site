(() => {
  const form = document.getElementById("handwritingForm");
  const canvas = document.getElementById("sampleCanvas");
  const ctx = canvas.getContext("2d");
  const status = document.getElementById("sampleStatus");
  const box = form.elements.glyph;
  const category = document.getElementById("sampleCategory");
  const example = document.getElementById("sampleExample");
  const exampleText = document.getElementById("sampleExampleText");
  const start = document.getElementById("startExample");
  const progress = document.getElementById("sampleProgress");
  const shortcuts = document.getElementById("sampleShortcuts");
  const clear = document.getElementById("clearSample");
  const submit = document.getElementById("saveSample");
  const skip = document.getElementById("skipSample");
  const end = document.getElementById("endExample");
  const sampleList = document.getElementById("savedSamples");
  const reset = document.getElementById("resetSamples");
  const examples = JSON.parse(document.getElementById("handwriting-examples").textContent);
  const saved = new Map(Array.from(sampleList.querySelectorAll("[data-saved-glyph]"), item => [item.dataset.savedGlyph, item]));
  let practice = null;
  let saving = false;
  let pointer = null;
  let drew = false;
  ctx.strokeStyle = "#243245";
  ctx.lineWidth = 9;
  ctx.lineCap = ctx.lineJoin = "round";
  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
  }
  function clearCanvas() {
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drew = false;
  }

  function renderExample() {
    const prompts = examples[category.value].prompts;
    exampleText.textContent = prompts[example.value];
  }

  function selectCategory() {
    const prompts = examples[category.value].prompts;
    example.replaceChildren(...prompts.map((_, index) => new Option(`예시 ${index + 1}`, index)));
    renderExample();
  }

  function renderPractice() {
    const active = Boolean(practice);
    box.readOnly = active;
    progress.hidden = skip.hidden = end.hidden = !active;
    shortcuts.hidden = active;
    submit.textContent = active && practice.index < practice.glyphs.length - 1 ? "저장하고 다음 글자" : "표본 저장";
    if (active) {
      box.value = practice.glyphs[practice.index];
      progress.textContent = `예시문 연습 ${practice.index + 1} / ${practice.glyphs.length} · ${box.value}`;
    }
  }

  function advancePractice() {
    clearCanvas();
    practice.index++;
    if (practice.index >= practice.glyphs.length) {
      practice = null;
      box.value = "";
      status.textContent = "예시문 연습을 마쳤어요.";
    } else {
      status.textContent = "다음 글자를 써 주세요.";
    }
    renderPractice();
  }

  function showSavedGlyph(glyph) {
    let item = saved.get(glyph);
    if (!item) {
      document.getElementById("emptySamples")?.remove();
      item = document.createElement("li");
      item.dataset.savedGlyph = glyph;
      sampleList.append(item);
      saved.set(glyph, item);
    }
    const label = document.createElement("strong");
    label.textContent = glyph;
    item.replaceChildren(label);
    reset.hidden = false;
  }

  category.addEventListener("change", selectCategory);
  example.addEventListener("change", renderExample);
  selectCategory();
  start.addEventListener("click", () => {
    if (saving) return;
    const characters = Array.from(exampleText.textContent.normalize("NFC"));
    const glyphs = [...new Set(characters.filter(glyph => /[\p{L}\p{N}\p{P}\p{S}]/u.test(glyph)))].filter(glyph => !saved.has(glyph));
    if (!glyphs.length) {
      status.textContent = "이 예시문의 글자는 모두 등록했어요.";
      return;
    }
    clearCanvas();
    practice = {glyphs, index: 0};
    status.textContent = "아직 등록하지 않은 글자를 순서대로 써 주세요.";
    renderPractice();
    canvas.scrollIntoView({block: "nearest"});
  });
  skip.addEventListener("click", () => {
    if (practice && !saving) advancePractice();
  });
  end.addEventListener("click", () => {
    if (saving) return;
    practice = null;
    clearCanvas();
    box.value = "";
    status.textContent = "등록할 글자를 하나 입력해 주세요.";
    renderPractice();
    box.focus();
  });

  canvas.addEventListener("pointerdown", event => {
    if (saving || pointer !== null || event.button !== 0) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    const [x, y] = position(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + .1, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    drew = true;
  });
  canvas.addEventListener("pointermove", event => {
    if (pointer !== event.pointerId) return;
    const point = position(event);
    ctx.lineTo(...point);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...point);
  });
  canvas.addEventListener("lostpointercapture", event => { if (pointer === event.pointerId) pointer = null; });
  clear.addEventListener("click", () => { if (!saving) clearCanvas(); });
  form.querySelectorAll("[data-glyph]").forEach(button => button.addEventListener("click", () => { box.value = button.dataset.glyph; }));
  reset.addEventListener("submit", event => {
    if (saving || !window.confirm("등록한 글자 모양과 맞춤 인식 기록을 모두 지울까요?")) event.preventDefault();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    if (!drew) { status.textContent = "연습 칸에 글자를 먼저 써 주세요."; return; }
    const data = new FormData(form);
    data.set("image_data", canvas.toDataURL("image/png"));
    saving = true;
    submit.disabled = true;
    try {
      const response = await fetch(location.href, {method: "POST", body: data});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      showSavedGlyph(result.glyph);
      if (practice) advancePractice();
      else {
        clearCanvas();
        status.textContent = `‘${result.glyph}’ 표본을 저장했어요.`;
      }
    } catch (error) { status.textContent = error.message || "표본을 저장하지 못했어요."; }
    finally { saving = false; submit.disabled = false; }
  });
})();
