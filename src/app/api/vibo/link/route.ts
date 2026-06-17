import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* PUBLIC (middleware-exempt). The Zapier zap that creates the Vibo event POSTs
   the host/join link back here so the client's planning page can show it.
   Auth: header  x-xos-key: <CRON_SECRET>.  Body: { token, host_link }. */

export const dynamic = "force-dynamic";

type AnyObj = Record<string, unknown>;

/** Read a POST body whether it's JSON or form-encoded; dig one level into a
    nested `data`/`body` wrapper too (Zapier shapes vary). */
/** Trim whitespace off every key (Zapier sometimes leaves a trailing space in
    a data key, e.g. "token "), recursing one level. */
function normalizeKeys(o: AnyObj): AnyObj {
  const out: AnyObj = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    out[k.trim()] = v && typeof v === "object" && !Array.isArray(v) ? normalizeKeys(v as AnyObj) : v;
  }
  return out;
}

function extract(raw: string): { obj: AnyObj; token: string; host: string } {
  let parsed: AnyObj = {};
  try {
    parsed = JSON.parse(raw) as AnyObj;
  } catch {
    try {
      parsed = Object.fromEntries(new URLSearchParams(raw));
    } catch {
      parsed = {};
    }
  }
  const obj = normalizeKeys(parsed);
  const pick = (o: AnyObj, k: string) => (typeof o?.[k] === "string" ? (o[k] as string).trim() : "");
  const nested = (typeof obj.data === "object" ? (obj.data as AnyObj) : typeof obj.body === "object" ? (obj.body as AnyObj) : {}) as AnyObj;
  const token = pick(obj, "token") || pick(nested, "token");
  const host = pick(obj, "host_link") || pick(obj, "link") || pick(nested, "host_link") || pick(nested, "link");
  return { obj, token, host };
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-xos-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  const { token, host } = extract(raw);
  if (!token || !host) {
    // echo what we received so a Zapier test shows the actual shape
    return NextResponse.json({ error: "Missing token or host_link.", received: raw.slice(0, 400) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: ev } = await supabase.from("events").select("id, custom_fields").eq("pay_token", token).maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid token." }, { status: 404 });

  const cf = { ...((ev.custom_fields as Record<string, string>) ?? {}), vibo_link: host };
  const { error } = await supabase.from("events").update({ custom_fields: cf }).eq("id", ev.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
