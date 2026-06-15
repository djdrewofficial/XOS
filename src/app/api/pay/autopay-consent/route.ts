import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/* PUBLIC (middleware-exempt). Records the client's autopay authorization from the
   payment screen and flips events.autopay_enabled so the next PayPal payment
   vaults the card. The unguessable pay_token is the authorization. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ev } = await supabase
    .from("events")
    .select("id, client:clients(first_name, last_name)")
    .eq("pay_token", token)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ua = hdrs.get("user-agent") ?? "unknown";
  const c = ev.client as { first_name?: string; last_name?: string } | null;
  const name = `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || null;

  const { error } = await supabase
    .from("events")
    .update({
      autopay_enabled: true,
      autopay_consent_at: new Date().toISOString(),
      autopay_consent_ip: ip,
      autopay_consent_ua: ua,
      autopay_consent_name: name,
    })
    .eq("id", ev.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
