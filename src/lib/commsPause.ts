import type { SupabaseClient } from "@supabase/supabase-js";

/* Per-event "pause automated communications" helper, shared by the email + SMS
   outbox drains. Given the event ids in a claimed batch, returns the subset whose
   events have comms_paused = true, so client-facing messages for them are suppressed. */
export async function pausedEventIdSet(
  supabase: SupabaseClient,
  eventIds: (string | null | undefined)[],
): Promise<Set<string>> {
  const uniq = [...new Set(eventIds.filter((x): x is string => !!x))];
  if (uniq.length === 0) return new Set();
  const { data } = await supabase.from("events").select("id").in("id", uniq).eq("comms_paused", true);
  return new Set((data ?? []).map((e) => e.id as string));
}
