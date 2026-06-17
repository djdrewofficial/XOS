import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* PUBLIC (middleware-exempt). The Zapier zap that creates the Vibo event POSTs
   the host/join link back here so the client's planning page can show it.
   Auth: header  x-xos-key: <CRON_SECRET>.  Body: { token, host_link }. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-xos-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { token?: string; host_link?: string; guest_link?: string; link?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  const host = (body.host_link ?? body.link ?? "").toString().trim();
  const guest = (body.guest_link ?? "").toString().trim();
  if (!token || !host) return NextResponse.json({ error: "Missing token or host_link." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ev } = await supabase.from("events").select("id, custom_fields").eq("pay_token", token).maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid token." }, { status: 404 });

  // vibo_link = host (the client/owner); vibo_guest_link = guest (partner/planner)
  const cf: Record<string, string> = { ...((ev.custom_fields as Record<string, string>) ?? {}), vibo_link: host };
  if (guest) cf.vibo_guest_link = guest;
  const { error } = await supabase.from("events").update({ custom_fields: cf }).eq("id", ev.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
