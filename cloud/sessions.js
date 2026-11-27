import {supabaseUrl, supabasePublishableKey} from "./config.js";
import {supabaseClient, value} from "./api.js";

export async function sessionStore() {
  if (!supabaseUrl || !supabasePublishableKey) return null;
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const sdk = document.createElement("script");
      sdk.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.93.3/dist/umd/supabase.js";
      sdk.integrity = "sha384-+ZU0FLgmXrUNVwx4Nmuay6i8PA8Ouf1KPCdacpklfY0SOT3teDcnp9j74VIF2evS";
      sdk.crossOrigin = "anonymous";
      sdk.onload = resolve;
      sdk.onerror = reject;
      document.head.append(sdk);
    });
  }
  const client = supabaseClient();
  const {session} = await value(client.auth.getSession());
  if (!session) return null;
  const member = await value(client.from("sapgu_members").select("user_id").maybeSingle());
  if (!member) return null;
  return {
    userId: member.user_id,
    async save(record) {
      await value(client.from("sapgu_study_sessions").upsert({...record, owner_id: member.user_id},
        {onConflict: "owner_id,client_id", ignoreDuplicates: true}));
    },
    async list() {
      const table = client.from("sapgu_study_sessions");
      const sessions = await value(table.select("client_id,subject,mode,started_at,ended_at,duration_seconds")
        .order("started_at", {ascending: false}).limit(1000));
      return sessions.map(record => ({...record, id: record.client_id}));
    },
  };
}
