import type { SupabaseClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";

/** Send only the rows this action queued for one event. An empty id list sends
    nothing. It does not claim the rest of the outbox. */
export async function drainEventOutbox(admin: SupabaseClient, eventId: string, sinceIso: string) {
  const [{ data: emails, error: emailError }, { data: texts, error: smsError }] = await Promise.all([
    admin.from("email_log").select("id").eq("event_id", eventId).eq("status", "queued").gte("created_at", sinceIso),
    admin.from("sms_log").select("id").eq("event_id", eventId).eq("status", "queued").gte("created_at", sinceIso),
  ]);
  if (emailError) throw new Error(emailError.message);
  if (smsError) throw new Error(smsError.message);
  const email = await processOutbox(admin, { onlyIds: (emails ?? []).map((row) => row.id as string) });
  const sms = await processSmsOutbox(admin, { onlyIds: (texts ?? []).map((row) => row.id as string) });
  return { email, sms };
}
