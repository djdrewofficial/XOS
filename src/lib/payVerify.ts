import "server-only";
import { createHash, randomInt, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164, isHighLevelConfigured, processSmsOutbox } from "@/lib/highlevel";

/* Phone-verification gate for the public pay page. A client proves they hold the
   mobile number on file for the booking by entering it + a 6-digit code we text
   them. On success we issue a session token (stored on the challenge row) that
   the browser carries in the httpOnly `pay_sess` cookie; the pay page and the
   money endpoints check it before revealing the balance / taking payment.

   All access here uses the service-role admin client (pay_verifications has RLS
   on with no policies). Never returns or logs the raw code. */

export const PAY_SESSION_COOKIE = "pay_sess";

const CODE_TTL_MIN = 10;
const SESSION_TTL_MIN = 45;
const MAX_ATTEMPTS = 6;
const MAX_SENDS_PER_HOUR = 5;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

type EventRow = { id: string; client_id: string | null };

async function eventByToken(admin: SupabaseClient, token: string): Promise<EventRow | null> {
  const { data } = await admin.from("events").select("id, client_id").eq("pay_token", token).maybeSingle();
  return (data as EventRow | null) ?? null;
}

/** Whether the pay page should require phone verification. Off when SMS isn't
    configured (so we never lock a client out with no way to deliver a code). */
export async function payVerifyRequired(admin: SupabaseClient): Promise<boolean> {
  if (!isHighLevelConfigured()) return false;
  const { data } = await admin
    .from("payment_settings")
    .select("require_pay_verification")
    .eq("id", true)
    .maybeSingle();
  return (data as { require_pay_verification?: boolean } | null)?.require_pay_verification !== false;
}

/** True when the cookie's session token is a live verified session for this token's event. */
export async function isPayVerified(
  admin: SupabaseClient,
  token: string,
  sessionValue: string | null
): Promise<boolean> {
  if (!sessionValue) return false;
  const ev = await eventByToken(admin, token);
  if (!ev) return false;
  const { data } = await admin
    .from("pay_verifications")
    .select("id")
    .eq("event_id", ev.id)
    .eq("session_token", sessionValue)
    .gt("session_expires_at", new Date().toISOString())
    .maybeSingle();
  return !!data;
}

/** Step 1: the client enters a phone number. If it matches the number on file,
    text them a fresh code and record the challenge. */
export async function startPayVerification(
  admin: SupabaseClient,
  token: string,
  rawPhone: string
): Promise<{ ok: true; last4: string } | { ok: false; error: string }> {
  const ev = await eventByToken(admin, token);
  if (!ev || !ev.client_id) return { ok: false, error: "This payment link isn't valid." };

  const { data: client } = await admin
    .from("clients")
    .select("cell_phone")
    .eq("id", ev.client_id)
    .maybeSingle();
  const onFile = toE164((client as { cell_phone?: string } | null)?.cell_phone ?? "");
  const entered = toE164(rawPhone ?? "");

  if (!onFile) {
    return { ok: false, error: "We don't have a mobile number on file for this booking. Please contact us to pay." };
  }
  if (!entered || entered !== onFile) {
    return { ok: false, error: "That number doesn't match the mobile number on file for this booking." };
  }

  // simple per-event rate limit on code sends
  const sinceHr = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("pay_verifications")
    .select("id", { count: "exact", head: true })
    .eq("event_id", ev.id)
    .gt("created_at", sinceHr);
  if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
    return { ok: false, error: "Too many code requests. Please wait a little while and try again." };
  }

  const code = genCode();
  const last4 = onFile.slice(-4);
  await admin.from("pay_verifications").insert({
    event_id: ev.id,
    code_hash: hashCode(code),
    phone_last4: last4,
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString(),
  });
  await admin.from("sms_log").insert({
    event_id: ev.id,
    client_id: ev.client_id,
    to_number: onFile,
    body: `Your Xpress Entertainment payment code is ${code}. It expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore this text.`,
  });
  await processSmsOutbox(admin);
  return { ok: true, last4 };
}

/** Step 2: verify the code. On success, issue a session token for the cookie. */
export async function checkPayCode(
  admin: SupabaseClient,
  token: string,
  rawCode: string
): Promise<{ ok: true; session: string } | { ok: false; error: string }> {
  const ev = await eventByToken(admin, token);
  if (!ev) return { ok: false, error: "This payment link isn't valid." };

  const code = (rawCode ?? "").toString().trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code we texted you." };

  const { data: chal } = await admin
    .from("pay_verifications")
    .select("id, code_hash, attempts")
    .eq("event_id", ev.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const challenge = chal as { id: string; code_hash: string; attempts: number } | null;
  if (!challenge) return { ok: false, error: "That code has expired. Please request a new one." };
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Please request a new code." };
  }

  await admin.from("pay_verifications").update({ attempts: challenge.attempts + 1 }).eq("id", challenge.id);
  if (hashCode(code) !== challenge.code_hash) {
    return { ok: false, error: "That code isn't right. Please try again." };
  }

  const session = randomUUID();
  const now = new Date();
  await admin
    .from("pay_verifications")
    .update({
      session_token: session,
      session_expires_at: new Date(now.getTime() + SESSION_TTL_MIN * 60 * 1000).toISOString(),
      verified_at: now.toISOString(),
      consumed_at: now.toISOString(),
    })
    .eq("id", challenge.id);
  return { ok: true, session };
}
