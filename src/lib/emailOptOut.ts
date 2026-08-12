import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/* XOS-owned email suppression (unsubscribe) list — the CAN-SPAM list checked
   before every MARKETING email is sent (processOutbox). Mirrors smsOptOut.ts.
   Populated by the public one-click /api/unsubscribe route/header and by staff.
   Keyed by lowercased email; opted_out=true suppresses, false is an explicit
   re-subscribe, no row = subscribed. Transactional mail (agreements, receipts,
   invites, reminders) is NEVER suppressed. */

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// Server secret for signing unsubscribe tokens. Prod always has the service-role
// key; the dev fallback keeps local links working (tokens are not security-critical
// — the worst case of a forged token is opting a known address out of marketing).
function unsubSecret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "xos-unsubscribe-dev-secret"
  );
}

/** Stateless per-recipient unsubscribe token: base64url(email).hmac — no DB row to
    provision. The /api/unsubscribe route verifies the HMAC and extracts the email. */
export function unsubscribeToken(email: string): string {
  const payload = Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
  const sig = createHmac("sha256", unsubSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify + extract the email from an unsubscribe token (null if tampered/invalid). */
export function emailFromUnsubToken(token: string | null | undefined): string | null {
  const t = (token ?? "").toString();
  const dot = t.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  const expected = createHmac("sha256", unsubSecret()).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    return normalizeEmail(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Is this email currently opted out of marketing mail? Unknown/invalid → false. */
export async function isEmailOptedOut(admin: SupabaseClient, rawEmail: string | null | undefined): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  const { data } = await admin.from("email_opt_outs").select("opted_out").eq("email", email).maybeSingle();
  return data?.opted_out === true;
}

/** Record an opt-out / opt-in signal for an email. Monotonic on signal_at (like SMS):
    an older signal can't clobber a newer decision. Staff/link signals use now(). */
export async function recordEmailOptSignal(
  admin: SupabaseClient,
  rawEmail: string | null | undefined,
  opts: { optedOut: boolean; source: string; reason?: string | null; signalAt?: Date },
): Promise<{ ok: boolean; email?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false };
  const signalAt = opts.signalAt ?? new Date();
  const { data: existing } = await admin
    .from("email_opt_outs")
    .select("signal_at")
    .eq("email", email)
    .maybeSingle();
  if (existing && new Date(existing.signal_at as string).getTime() >= signalAt.getTime()) {
    return { ok: true, email }; // stale signal — a newer decision already stands
  }
  await admin.from("email_opt_outs").upsert(
    {
      email,
      opted_out: opts.optedOut,
      source: opts.source,
      reason: opts.reason ?? null,
      signal_at: signalAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  return { ok: true, email };
}
