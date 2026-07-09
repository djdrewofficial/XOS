import { NextResponse } from "next/server";
import { sendPasswordResetCode } from "@/lib/accounts";

/* Public "forgot password" for the couples/guest app. Emails a BRANDED 6-digit
   code (Mailgun) that the app verifies with Supabase (verifyOtp type
   "recovery"), so the whole reset stays in-app — no deep link. Always returns
   ok so it never reveals whether an account exists (no user enumeration).

   No JWT here (unlike the other /api/mobile routes): the user isn't signed in
   yet when they tap "Forgot password?". */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      await sendPasswordResetCode(email);
    } catch {
      /* swallow — the caller always sees the same generic confirmation */
    }
  }
  return NextResponse.json({ ok: true });
}
