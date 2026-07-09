import { NextResponse } from "next/server";
import { sendPasswordReset } from "@/lib/accounts";

/* Public "forgot password" for the couples/guest app. Mirrors the web login
   action (src/app/login/actions.ts): always returns ok so it never reveals
   whether an account exists (no user enumeration), and delivers the BRANDED
   Mailgun recovery link — which deep-links client/guest accounts to
   xpressclient://auth/set-password so they set a new password in-app.

   No JWT here (unlike the other /api/mobile routes): the user isn't signed in
   yet when they tap "Forgot password?". */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      await sendPasswordReset(email);
    } catch {
      /* swallow — the caller always sees the same generic confirmation */
    }
  }
  return NextResponse.json({ ok: true });
}
