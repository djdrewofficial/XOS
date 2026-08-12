import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startPayVerification } from "@/lib/payVerify";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";

/* PUBLIC (middleware-exempt). Step 1 of the pay-page phone gate: the client
   submits the mobile number on file; if it matches, we text a 6-digit code. */

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const MAX_SEND_PER_IP = 20; // per-IP cap (defense in depth alongside the per-event 5/hr)

export async function POST(req: Request) {
  let body: { token?: string; phone?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  const phone = (body.phone ?? "").toString();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const admin = createAdminClient();

  // Per-IP throttle (cheap gate against scripted abuse across tokens/events),
  // above the per-event limit so a normal payer never hits it.
  const ip = clientIp(req);
  if (ip && (await isRateLimited(admin, "pay_verify_send:ip", ip, MAX_SEND_PER_IP, HOUR))) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }
  if (ip) await recordRateHit(admin, "pay_verify_send:ip", ip, HOUR);

  const res = await startPayVerification(admin, token, phone);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, last4: res.last4 });
}
