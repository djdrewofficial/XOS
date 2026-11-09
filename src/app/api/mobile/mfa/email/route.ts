import { NextResponse } from "next/server";
import { sendEmailMfaCodeForSession, verifyEmailMfaCodeForSession } from "@/lib/emailMfaServer";

/* Email second-factor codes for the XOS Staff app's sign-in step. Same rules
   and database functions as the web /2fa page (00209_staff_email_mfa.sql);
   the app sends its Supabase access token instead of cookies.

   Body: { action: "send" } or { action: "verify", code: "123456" }.
   Always "signin" purpose — enrolling email codes stays on the web. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "You need to be signed in again." }, 401);
  const body = (await req.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;
  if (body?.action === "send") {
    const result = await sendEmailMfaCodeForSession("signin", token);
    return json(result, result.ok ? 200 : 400);
  }
  if (body?.action === "verify") {
    const code = typeof body.code === "string" ? body.code : "";
    const result = await verifyEmailMfaCodeForSession("signin", code, token);
    return json(result, result.ok ? 200 : 400);
  }
  return json({ ok: false, error: "That code didn't work." }, 400);
}
