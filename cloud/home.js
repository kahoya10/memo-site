import {loadSupabaseClient, value} from "./api.js";

const signIn = document.getElementById("homeSignIn");
const signOut = document.getElementById("homeSignOut");
const account = document.getElementById("homeAccount");
const status = document.getElementById("homeAuthStatus");

async function start() {
  const client = await loadSupabaseClient();
  function show(session) {
    signIn.hidden = Boolean(session);
    signOut.hidden = account.hidden = !session;
    account.textContent = session ? session.user.email?.split("@")[0] || "로그인됨" : "";
  }
  show((await value(client.auth.getSession())).session);
  client.auth.onAuthStateChange((_event, session) => show(session));
  window.addEventListener("pageshow", async event => {
    if (!event.persisted) return;
    try { show((await value(client.auth.getSession())).session); }
    catch { show(null); }
  });
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await value(client.auth.signOut({scope: "local"}));
      show(null);
      status.textContent = "로그아웃했어요.";
    } catch {
      status.textContent = "로그아웃하지 못했어요. 다시 시도해 주세요.";
    } finally {
      signOut.disabled = false;
    }
  });
}

start().catch(() => {});
