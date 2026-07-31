import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordResetCode } from "@/lib/accounts";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";

/* Public "forgot password" for the couples/guest app. Emails a BRANDED 6-digit
   code (Mailgun) that the app verifies with Supabase (verifyOtp type
   "recovery"), so the whole reset stays in-app — no deep link. Always returns
   ok so it never reveals whether an account exists (no user enumeration).

   No JWT here (unlike the other /api/mobile routes): the user isn't signed in
   yet when they tap "Forgot password?".

   Rate limited per-email AND per-IP so it can't be looped to bomb a victim's
   inbox or burn Mailgun reputation. Over the limit we SILENTLY skip the send and
   still return ok — the response stays byte-identical (no enumeration or
   rate-state leak), and a legit user who just requested one already has a valid
   code. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HOUR = 60 * 60 * 1000;
const MAX_PER_EMAIL_PER_HOUR = 3; // protects one victim's inbox
const MAX_PER_IP_PER_HOUR = 10; // caps mass-looping across many addresses

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    const admin = createAdminClient();
    const ip = clientIp(req);
    const overEmail = await isRateLimited(admin, "pwreset:email", email, MAX_PER_EMAIL_PER_HOUR, HOUR);
    const overIp = ip ? await isRateLimited(admin, "pwreset:ip", ip, MAX_PER_IP_PER_HOUR, HOUR) : false;
    if (!overEmail && !overIp) {
      await recordRateHit(admin, "pwreset:email", email, HOUR);
      if (ip) await recordRateHit(admin, "pwreset:ip", ip, HOUR);
      try {
        await sendPasswordResetCode(email);
      } catch {
        /* swallow — the caller always sees the same generic confirmation */
      }
    }
  }
  return NextResponse.json({ ok: true });
}
