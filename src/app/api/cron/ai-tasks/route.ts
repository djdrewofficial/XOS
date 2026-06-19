import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMorningBriefing } from "@/lib/morningBriefing";
import { runVendorMatching } from "@/lib/vendorMatch";

/* Hourly dispatcher for the daily AI tasks. Reads ai_tasks (managed in
   Settings → AI Assistant) and runs each enabled task once on its configured
   hour, in the company's timezone. Trigger with Bearer <CRON_SECRET>. */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

function localParts(tz: string): { hour: number; date: string } {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
  // en-CA gives YYYY-MM-DD
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { hour: hour === 24 ? 0 : hour, date };
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const force = new URL(req.url).searchParams.get("force") === "1";

  const { data: cs } = await admin.from("company_settings").select("timezone").eq("id", true).maybeSingle();
  const tz = cs?.timezone || "America/New_York";
  const { hour, date } = localParts(tz);

  const { data: tasks } = await admin.from("ai_tasks").select("*").eq("enabled", true);
  const ran: { key: string; ok: boolean; error?: string | null }[] = [];

  for (const t of tasks ?? []) {
    const cfg = (t.config ?? {}) as { recipients?: string; hour?: number };
    const due = force || ((cfg.hour ?? 7) === hour && t.last_run_on !== date);
    if (!due) continue;
    try {
      if (t.key === "morning_briefing") {
        await sendMorningBriefing(admin, cfg.recipients || "events@xpressdjs.com");
      } else if (t.key === "vendor_matching") {
        await runVendorMatching(admin);
      } else {
        continue;
      }
      await admin.from("ai_tasks").update({ last_run_on: date }).eq("key", t.key);
      ran.push({ key: t.key, ok: true });
    } catch (e) {
      ran.push({ key: t.key, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }

  return NextResponse.json({ ok: true, tz, hour, date, ran });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
