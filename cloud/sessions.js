import {loadSupabaseClient, value} from "./api.js";

export async function sessionStore() {
  const client = await loadSupabaseClient();
  const {session} = await value(client.auth.getSession());
  if (!session) return null;
  const member = await value(client.from("sapgu_members").select("user_id").maybeSingle());
  if (!member) return null;
  return {
    userId: member.user_id,
    watchAccount(onChange) {
      client.auth.onAuthStateChange((_event, current) => {
        if (current?.user.id !== member.user_id) onChange();
      });
    },
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
