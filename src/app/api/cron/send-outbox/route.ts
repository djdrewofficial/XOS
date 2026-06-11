import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/mailgun";
import { createAdminClient } from "@/lib/supabase/admin";

/* Protected outbox drainer. Trigger every minute from pg_cron (see migration 00023)
   or any external scheduler, with header:  Authorization: Bearer <CRON_SECRET>.
   Runs with the service-role client so it works with no user session. */

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processOutbox(createAdminClient());
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return run(req);
}

// Allow GET too, so simple cron services that only do GET can trigger it.
export async function GET(req: Request) {
  return run(req);
}
