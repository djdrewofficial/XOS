import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* PUBLIC (middleware-exempt). The Zapier zap that creates the Vibo event POSTs
   the host/join link back here so the client's planning page can show it.
   Auth: header  x-xos-key: <CRON_SECRET>.  Body: { token, host_link }. */

export const dynamic = "force-dynamic";

/** Read a POST body whether it's JSON or form-encoded (Zapier can send either). */
async function readBody(req: Request): Promise<Record<string, string>> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    /* not json */
  }
  try {
    return Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-xos-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await readBody(req);
  const token = (body.token ?? "").toString();
  const host = (body.host_link ?? body.link ?? "").toString().trim();
  if (!token || !host) return NextResponse.json({ error: "Missing token or host_link." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ev } = await supabase.from("events").select("id, custom_fields").eq("pay_token", token).maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid token." }, { status: 404 });

  const cf = { ...((ev.custom_fields as Record<string, string>) ?? {}), vibo_link: host };
  const { error } = await supabase.from("events").update({ custom_fields: cf }).eq("id", ev.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
