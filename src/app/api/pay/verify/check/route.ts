import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPayCode, PAY_SESSION_COOKIE } from "@/lib/payVerify";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";

/* PUBLIC (middleware-exempt). Step 2 of the pay-page phone gate: verify the
   texted code. On success we set an httpOnly session cookie the pay page and
   the money endpoints check. */

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const MAX_CHECK_PER_IP = 40; // per-IP cap (defense in depth alongside the per-event 6 attempts)

export async function POST(req: Request) {
  let body: { token?: string; code?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  const code = (body.code ?? "").toString();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const admin = createAdminClient();

  // Per-IP throttle to bound cross-token/cross-event code brute-forcing from one
  // IP, above the per-event 6-attempt cap so a normal payer never hits it.
  const ip = clientIp(req);
  if (ip && (await isRateLimited(admin, "pay_verify_check:ip", ip, MAX_CHECK_PER_IP, HOUR))) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }
  if (ip) await recordRateHit(admin, "pay_verify_check:ip", ip, HOUR);

  const out = await checkPayCode(admin, token, code);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PAY_SESSION_COOKIE, out.session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 45 * 60,
  });
  return res;
}
