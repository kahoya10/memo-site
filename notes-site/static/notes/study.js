(() => {
  const app = document.getElementById("studyApp");
  const byId = id => document.getElementById(id);
  const pages = JSON.parse(byId("study-data").textContent);
  const materials = (page, kind, items) => items.map((item, index) => ({
    page, bounds: item.bounds, term: kind === "term" ? item : null, key: page.id + ":" + kind + ":" + (item.id ?? index),
  }));
  const questions = pages.flatMap(page => [...materials(page, "blank", page.blanks), ...materials(page, "term", page.terms)]);
  const cards = pages.flatMap(page => materials(page, "card", page.cards));
  const controls = ["quizText", "quizInk", "quizInput", "quizSource", "cardGame", "startQuiz", "toggleAnswer", "markCorrect", "markIncorrect", "finishQuiz", "saveQuiz", "reloadQuiz", "quizTime"];
  const message = byId("quizMessage");
  const modes = [...app.querySelectorAll("[data-mode]")];
  const quizPage = byId("quizPage");
  let mode;
  let round = [];
  let results = [];
  let index = 0;
  let startedAt;
  let timer;
  let finished = true;
  let pending = null;
  let saving = false;

  function show(...ids) { controls.forEach(id => { byId(id).hidden = !ids.includes(id); }); }
  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const other = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[other]] = [copy[other], copy[i]];
    }
    return copy;
  }
  function setMode(next) {
    if (saving) return;
    if (pending && !window.confirm("아직 저장하지 못한 기록을 버릴까요?")) return;
    if (!finished && !window.confirm("진행 중인 학습을 끝낼까요?")) return;
    clearInterval(timer);
    pending = null;
    finished = true;
    mode = next;
    modes.forEach(button => {
      button.classList.toggle("primary", button.dataset.mode === mode);
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
    byId("quizLocation").textContent = byId("quizCount").textContent = "";
    const pool = mode === "card" ? cards : questions;
    const pageIds = new Set(pool.map(item => item.page.id));
    quizPage.replaceChildren(new Option("전체", ""), ...pages.filter(page => pageIds.has(page.id)).map(page => new Option(page.chapter + " · " + page.title, page.id)));
    showStart();
  }
  function selectedQuestions() {
    const pool = mode === "card" ? cards : questions;
    return quizPage.value ? pool.filter(item => String(item.page.id) === quizPage.value) : pool;
  }
  function showStart() {
    const available = selectedQuestions().length;
    const ready = mode === "card" ? available >= 2 : available > 0;
    const visible = quizPage.options.length > 2 ? ["quizSource"] : [];
    if (ready) visible.push("startQuiz");
    show(...visible);
    const instructions = {
      blank: "가려진 내용을 떠올리고 정답을 확인해 보세요.",
      card: "가려진 필기와 그 자리에 들어갈 손글씨 카드를 짝지으세요.",
      speed: "45초 안에 최대 10문제를 풀어요. 손글씨 문제는 답을 본 뒤 직접 채점합니다.",
    };
    message.textContent = ready ? instructions[mode] : mode === "card"
      ? "카드 볼펜 또는 카드 형광펜으로 두 곳 이상 표시해 주세요."
      : "‘빈칸’ 형광펜으로 표시하거나 인식 확인에서 핵심어를 저장해 주세요.";
  }
  function scene(question, canvas, answerOnly = false, covered = true) {
    const [left, top, right, bottom] = question.bounds;
    const area = answerOnly ? question.bounds : [Math.max(0, left - .18), Math.max(0, top - .05), Math.min(1, right + .18), Math.min(1, bottom + .05)];
    drawPageInk(canvas, question.page.ink, area, covered ? question.bounds : null);
  }
  function textQuestion(question, revealed) {
    const element = byId("quizText");
    const text = question.page.text;
    const escaped = question.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    element.replaceChildren();
    let offset = 0;
    for (const match of text.matchAll(new RegExp(escaped, "gi"))) {
      element.append(text.slice(offset, match.index));
      const slot = document.createElement("span");
      slot.className = revealed ? "quiz-blank revealed" : "quiz-blank";
      slot.textContent = revealed ? match[0] : "　".repeat(Math.min(12, match[0].length));
      element.append(slot);
      offset = match.index + match[0].length;
    }
    element.append(text.slice(offset));
    if (!offset) element.append(revealed ? "\n" + question.term : "\n＿＿＿＿");
  }
  function renderQuestion() {
    if (index >= round.length) { finish(); return; }
    const question = round[index];
    message.textContent = "";
    byId("quizLocation").textContent = question.page.chapter + " · " + question.page.title;
    byId("quizCount").textContent = (index + 1) + " / " + round.length;
    const typed = mode === "speed" && !question.bounds;
    const visible = [question.bounds ? "quizInk" : "quizText", typed ? "quizInput" : "toggleAnswer"];
    if (mode === "speed") visible.push("quizTime");
    else if (results.length) visible.push("finishQuiz");
    show(...visible);
    if (question.bounds) {
      const container = byId("quizInk");
      container.className = "quiz-ink paper-" + question.page.paper;
      container.style.setProperty("--paper-image", question.page.paper_url ? "url(" + question.page.paper_url + ")" : "none");
      scene(question, container.querySelector("canvas"));
    } else textQuestion(question, false);
    if (typed) { byId("quizInput").reset(); byId("quizInput").elements.answer.focus(); }
  }
  function grade(correct) {
    if (finished) return;
    results.push({key: round[index].key, correct});
    index++;
    renderQuestion();
  }
  function renderCards() {
    show("cardGame");
    let selected = null;
    const wrong = new Set();
    const prompts = new Map();
    const answers = new Map();
    function renderCount() { byId("quizCount").textContent = results.length + " / " + round.length + "쌍"; }
    function make(question, position, answer) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "matching-card";
      button.textContent = (answer ? "답 " : "문제 ") + (position + 1);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      button.append(canvas);
      scene(question, canvas, answer, !answer);
      button.addEventListener("click", () => {
        if (!answer) {
          selected = question.key;
          prompts.forEach((node, key) => node.setAttribute("aria-pressed", String(key === selected)));
          message.textContent = "이 문제에 맞는 답을 선택하세요.";
          return;
        }
        if (selected === null) { message.textContent = "문제 카드를 먼저 선택하세요."; return; }
        if (selected !== question.key) { wrong.add(selected); message.textContent = "다른 카드예요. 다시 골라 보세요."; return; }
        prompts.get(selected).disabled = true;
        prompts.get(selected).setAttribute("aria-pressed", "false");
        button.disabled = true;
        results.push({key: selected, correct: !wrong.has(selected)});
        selected = null;
        message.textContent = "짝을 찾았어요.";
        renderCount();
        if (results.length === round.length) finish();
        else byId("finishQuiz").hidden = false;
      });
      return button;
    }
    round.forEach((question, i) => prompts.set(question.key, make(question, i, false)));
    shuffle(round).forEach((question, i) => answers.set(question.key, make(question, i, true)));
    byId("cardPrompts").replaceChildren(...prompts.values());
    byId("cardAnswers").replaceChildren(...answers.values());
    renderCount();
    message.textContent = "문제 카드 하나를 먼저 고르세요.";
  }
  function updateTimer() {
    const seconds = Math.max(0, 45 - Math.floor((Date.now() - startedAt) / 1000));
    byId("quizTime").textContent = seconds + "초";
    if (!seconds && !finished) {
      round.slice(index).forEach(question => results.push({key: question.key, correct: false}));
      finish("시간이 끝났어요. ");
    }
  }
  function start() {
    const available = selectedQuestions();
    round = mode === "card" ? shuffle(available).slice(0, 6) : mode === "speed" ? shuffle(available).slice(0, 10) : available.slice(0, 150);
    results = [];
    index = 0;
    startedAt = Date.now();
    finished = false;
    if (mode === "card") renderCards();
    else renderQuestion();
    if (mode === "speed") { updateTimer(); timer = setInterval(updateTimer, 250); }
  }
  async function saveResult() {
    if (!pending || saving) return;
    saving = true;
    byId("saveQuiz").hidden = true;
    byId("reloadQuiz").disabled = true;
    try {
      const response = await fetch(app.dataset.saveUrl, {method: "POST", headers: {
        "Content-Type": "application/json", "X-CSRFToken": app.querySelector("[name=csrfmiddlewaretoken]").value,
      }, body: JSON.stringify(pending)});
      if (!response.ok) throw new Error();
      message.textContent += " 학습 기록에 저장했어요.";
      const line = document.createElement("p");
      line.textContent = pending.results.filter(item => item.correct).length + "/" + pending.results.length + " · " + pending.duration + "초 · 방금 저장";
      app.querySelector(".quiz-records h2").after(line);
      pending = null;
    } catch {
      message.textContent += " 기록 저장에 실패했어요.";
      byId("saveQuiz").hidden = false;
    } finally {
      saving = false;
      byId("reloadQuiz").disabled = false;
    }
  }
  function finish(prefix = "") {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    show("reloadQuiz");
    message.textContent = prefix + results.length + "문제 중 " + results.filter(item => item.correct).length + "문제를 맞혔어요.";
    pending = {id: newRecordId(), mode, duration: Math.min(86400, Math.round((Date.now() - startedAt) / 1000)), results};
    saveResult();
  }
  modes.forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));
  quizPage.addEventListener("change", showStart);
  byId("startQuiz").addEventListener("click", start);
  byId("toggleAnswer").addEventListener("click", () => {
    const question = round[index];
    if (question.bounds) scene(question, byId("quizInk").querySelector("canvas"), false, false);
    else textQuestion(question, true);
    byId("toggleAnswer").hidden = true;
    byId("markCorrect").hidden = byId("markIncorrect").hidden = false;
  });
  byId("markCorrect").addEventListener("click", () => grade(true));
  byId("markIncorrect").addEventListener("click", () => grade(false));
  byId("quizInput").addEventListener("submit", event => {
    event.preventDefault();
    const normalize = value => value.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    grade(normalize(event.target.elements.answer.value) === normalize(round[index].term));
  });
  byId("finishQuiz").addEventListener("click", () => finish());
  byId("reloadQuiz").addEventListener("click", () => setMode(mode));
  byId("saveQuiz").addEventListener("click", saveResult);
  setMode("blank");
})();
