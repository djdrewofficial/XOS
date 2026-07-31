import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/phone";

/* XOS-owned SMS opt-out (STOP) list — the TCPA suppression list checked before
   every queued SMS is sent (processSmsOutbox). Populated from inbound STOP/START
   replies during HighLevel conversation sync and by staff on the client page.
   Keyed by E.164 phone; a row with opted_out=true suppresses, opted_out=false is
   an explicit re-subscribe, no row = subscribed. */

// Standard CTIA/TCPA opt-out keywords. We honor these liberally (match the whole
// body OR its first word) so a STOP is never missed.
export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
// Re-subscribe keywords — kept deliberate (no ambiguous "YES") so we never opt
// someone back in by accident.
export const START_KEYWORDS = ["START", "UNSTOP", "SUBSCRIBE", "OPTIN"];

/** Classify an inbound SMS body as a stop/start signal (null = neither). */
export function classifySmsKeyword(body: string | null | undefined): "stop" | "start" | null {
  const t = (body ?? "").trim().toUpperCase().replace(/[\s.!,-]+$/g, "");
  if (!t) return null;
  const first = t.split(/\s+/)[0].replace(/[^A-Z]/g, "");
  if (STOP_KEYWORDS.includes(t) || STOP_KEYWORDS.includes(first)) return "stop";
  if (START_KEYWORDS.includes(t) || START_KEYWORDS.includes(first)) return "start";
  return null;
}

/** Is this phone currently opted out of SMS? Unknown/invalid number → false. */
export async function isPhoneOptedOut(admin: SupabaseClient, rawPhone: string | null | undefined): Promise<boolean> {
  const phone = toE164(rawPhone ?? "");
  if (!phone) return false;
  const { data } = await admin.from("sms_opt_outs").select("opted_out").eq("phone", phone).maybeSingle();
  return data?.opted_out === true;
}

/** Record an opt-out / opt-in signal for a phone. Monotonic: an inbound signal
    only wins if its timestamp is newer than the current state's signal_at, so
    re-syncing an old STOP/START can't clobber a newer decision. Manual staff
    signals use signalAt = now(), so they always win over historical messages. */
export async function recordSmsOptSignal(
  admin: SupabaseClient,
  rawPhone: string | null | undefined,
  opts: { optedOut: boolean; source: string; reason?: string | null; signalAt?: Date },
): Promise<{ ok: boolean; phone?: string }> {
  const phone = toE164(rawPhone ?? "");
  if (!phone) return { ok: false };
  const signalAt = opts.signalAt ?? new Date();
  const { data: existing } = await admin
    .from("sms_opt_outs")
    .select("signal_at")
    .eq("phone", phone)
    .maybeSingle();
  if (existing && new Date(existing.signal_at as string).getTime() >= signalAt.getTime()) {
    return { ok: true, phone }; // stale signal — a newer decision already stands
  }
  await admin.from("sms_opt_outs").upsert(
    {
      phone,
      opted_out: opts.optedOut,
      source: opts.source,
      reason: opts.reason ?? null,
      signal_at: signalAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );
  return { ok: true, phone };
}

export type SmsOptStatus = {
  phone: string | null; // normalized E.164 (null if the number is unusable)
  optedOut: boolean;
  source: string | null;
  reason: string | null;
  updatedAt: string | null;
};

/** Current opt-out status for a phone, for display in the UI. */
export async function getSmsOptStatus(admin: SupabaseClient, rawPhone: string | null | undefined): Promise<SmsOptStatus> {
  const phone = toE164(rawPhone ?? "");
  if (!phone) return { phone: null, optedOut: false, source: null, reason: null, updatedAt: null };
  const { data } = await admin
    .from("sms_opt_outs")
    .select("opted_out, source, reason, updated_at")
    .eq("phone", phone)
    .maybeSingle();
  return {
    phone,
    optedOut: data?.opted_out === true,
    source: (data?.source as string | null) ?? null,
    reason: (data?.reason as string | null) ?? null,
    updatedAt: (data?.updated_at as string | null) ?? null,
  };
}
