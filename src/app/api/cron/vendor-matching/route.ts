import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runVendorMatching } from "@/lib/vendorMatch";

/* Daily GPT vendor matcher → builds the review queue (vendor_match_suggestions).
   Trigger with Authorization: Bearer <CRON_SECRET>. Applies nothing itself. */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  try {
    const result = await runVendorMatching(admin);
    return NextResponse.json({ ok: true, ...result });
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
