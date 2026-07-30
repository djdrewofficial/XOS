import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startPayVerification } from "@/lib/payVerify";

/* PUBLIC (middleware-exempt). Step 1 of the pay-page phone gate: the client
   submits the mobile number on file; if it matches, we text a 6-digit code. */

export const dynamic = "force-dynamic";

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
  const res = await startPayVerification(admin, token, phone);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, last4: res.last4 });
}
