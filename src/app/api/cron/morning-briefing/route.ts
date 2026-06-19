import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMorningBriefing } from "@/lib/morningBriefing";

/* Daily GPT morning briefing → emailed to the office. Trigger from the Netlify
   scheduled function (or any scheduler) with Authorization: Bearer <CRON_SECRET>. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "events@xpressdjs.com";
  const admin = createAdminClient();
  try {
    const result = await sendMorningBriefing(admin, to);
    return NextResponse.json({ ok: result.ok, error: result.error ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
