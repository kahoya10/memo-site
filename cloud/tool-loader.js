(() => {
  const {tool, toolScript} = document.body.dataset;
  const main = document.querySelector("main");
  const status = document.getElementById("toolAuthStatus");

  function launch() {
    const script = document.createElement("script");
    script.src = toolScript;
    script.onload = () => { status.hidden = true; };
    script.onerror = () => {
      main.hidden = true;
      status.textContent = "화면을 불러오지 못했어요. 새로고침해 주세요.";
    };
    main.hidden = false;
    document.body.append(script);
  }

  if (location.protocol === "file:") {
    launch();
    return;
  }

  async function start() {
    const {sessionStore} = await import("./sessions.js?v=account-1");
    const store = await sessionStore();
    if (!store) {
      location.replace(`./cloud/index.html?next=${encodeURIComponent(tool)}`);
      return;
    }
    document.body.dataset.userId = store.userId;
    window.sapguStudyStore = store;
    store.watchAccount(() => {
      main.hidden = true;
      location.replace(`./cloud/index.html?next=${encodeURIComponent(tool)}`);
    });
    window.addEventListener("pagehide", event => { if (event.persisted) main.hidden = true; });
    window.addEventListener("pageshow", event => {
      if (event.persisted) { main.hidden = true; location.reload(); }
    });
    launch();
  }

  start().catch(() => { status.textContent = "로그인을 확인하지 못했어요. 새로고침해 주세요."; });
})();
