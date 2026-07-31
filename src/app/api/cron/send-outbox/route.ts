import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox, syncHighLevelConversations } from "@/lib/highlevel";
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
  const admin = createAdminClient();
  const email = await processOutbox(admin);
  const sms = await processSmsOutbox(admin);
  // ?full=1 forces a complete conversation backfill (first run / repairs)
  const full = new URL(req.url).searchParams.get("full") === "1";
  const inbox = await syncHighLevelConversations(admin, { full });

  // If any stage reported a query/fetch error, fail the cron (500) so the
  // scheduler / uptime check sees it — a broken drainer must not return a
  // healthy 200 while nothing sends.
  const errors = [
    email.error && `email: ${email.error}`,
    sms.error && `sms: ${sms.error}`,
    inbox.error && `inbox: ${inbox.error}`,
  ].filter(Boolean);
  const status = errors.length ? 500 : 200;
  return NextResponse.json({ email, sms, inbox, ...(errors.length ? { errors } : {}) }, { status });
}

export async function POST(req: Request) {
  return run(req);
}

// Allow GET too, so simple cron services that only do GET can trigger it.
export async function GET(req: Request) {
  return run(req);
}
