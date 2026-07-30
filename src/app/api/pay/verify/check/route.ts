import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPayCode, PAY_SESSION_COOKIE } from "@/lib/payVerify";

/* PUBLIC (middleware-exempt). Step 2 of the pay-page phone gate: verify the
   texted code. On success we set an httpOnly session cookie the pay page and
   the money endpoints check. */

export const dynamic = "force-dynamic";

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
