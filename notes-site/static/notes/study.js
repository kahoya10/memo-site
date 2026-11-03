(() => {
  const data = JSON.parse(document.getElementById("study-data").textContent || "[]");
  if (!data.length) return;
  let pageIndex = 0;
  let termIndex = 0;
  let revealed = false;
  const textElement = document.getElementById("quizText");
  const answerButton = document.getElementById("toggleAnswer");
  const escapeHtml = value => value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function render() {
    const page = data[pageIndex];
    const term = page.terms[termIndex];
    const source = escapeHtml(page.text);
    const pattern = new RegExp(escapeRegExp(escapeHtml(term)), "gi");
    const replacement = `<span class="quiz-blank${revealed ? " revealed" : ""}">${escapeHtml(term)}</span>`;
    textElement.innerHTML = pattern.test(source) ? source.replace(pattern, replacement) : `${source}<p><span class="quiz-blank${revealed ? " revealed" : ""}">${escapeHtml(term)}</span></p>`;
    document.getElementById("quizLocation").textContent = `${page.chapter} · ${page.title}`;
    document.getElementById("quizCount").textContent = `${termIndex + 1} / ${page.terms.length}`;
    answerButton.textContent = revealed ? "다시 가리기" : "정답 보기";
    document.querySelectorAll("[data-study-index]").forEach((button, index) => button.classList.toggle("active", index === pageIndex));
  }
  answerButton.addEventListener("click", () => { revealed = !revealed; render(); });
  document.getElementById("nextQuiz").addEventListener("click", () => { const terms = data[pageIndex].terms; termIndex += 1; if (termIndex >= terms.length) { pageIndex = (pageIndex + 1) % data.length; termIndex = 0; } revealed = false; render(); });
  document.querySelectorAll("[data-study-index]").forEach(button => button.addEventListener("click", () => { pageIndex = Number(button.dataset.studyIndex); termIndex = 0; revealed = false; render(); }));
  render();
})();
