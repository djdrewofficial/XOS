import type { SupabaseClient } from "@supabase/supabase-js";

/* A row the email or SMS outbox is about to deliver. bypass_comms_pause is set
   only by a booking helper a person ran by hand (including a helper that one
   chains into). Automated rows leave it false. */
export type CommsOutboxRow = {
  client_id?: string | null;
  event_id?: string | null;
  bypass_comms_pause?: boolean | null;
};

/* Client-facing automated mail and texts on a paused event are dropped.
   A staff-clicked helper is not automated, so its rows go out. A row with no
   client (a staff alert) was never paused. */
export function isSuppressedByCommsPause(row: CommsOutboxRow, pausedEventIds: ReadonlySet<string>): boolean {
  if (row.bypass_comms_pause) return false;
  return Boolean(row.client_id && row.event_id && pausedEventIds.has(row.event_id));
}

/* Per-event "pause automated communications" helper, shared by the email + SMS
   outbox drains. Given the event ids in a claimed batch, returns the subset whose
   events have comms_paused = true, so client-facing automated messages for them
   are suppressed. */
export async function pausedEventIdSet(
  supabase: SupabaseClient,
  eventIds: (string | null | undefined)[],
): Promise<Set<string>> {
  const uniq = [...new Set(eventIds.filter((x): x is string => !!x))];
  if (uniq.length === 0) return new Set();
  const { data } = await supabase.from("events").select("id").in("id", uniq).eq("comms_paused", true);
  return new Set((data ?? []).map((e) => e.id as string));
}
