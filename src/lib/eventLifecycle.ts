import type { SupabaseClient } from "@supabase/supabase-js";

/** Hard-delete guard from the event page. A payment row must stay attached to
    its event, so an event with any payment history can only be archived. */
export async function assertEventDeletable(admin: SupabaseClient, eventId: string) {
  const { count, error } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) {
    throw new Error(
      "This event has payment history and can't be permanently deleted — that would orphan its payment records. Archive it instead: it'll be hidden and all automations stop, but the money records stay attributable.",
    );
  }
}

export async function archiveEventRecord(supabase: SupabaseClient, eventId: string, actor: string) {
  const { error } = await supabase.from("events").update({ archived_at: new Date().toISOString() }).eq("id", eventId);
  if (error) throw new Error(error.message);
  await supabase.from("email_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");
  await supabase.from("sms_log").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "queued");
  await supabase.from("event_logs").insert({ event_id: eventId, actor, action: "Event archived" });
}

export async function unarchiveEventRecord(supabase: SupabaseClient, eventId: string, actor: string) {
  const { error } = await supabase.from("events").update({ archived_at: null }).eq("id", eventId);
  if (error) throw new Error(error.message);
  await supabase.from("event_logs").insert({ event_id: eventId, actor, action: "Event unarchived" });
}
