import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox, syncHighLevelConversations } from "@/lib/highlevel";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited, recordRateHit } from "@/lib/rateLimit";

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

  // Total send failure = a stage attempted sends this run and EVERY one failed
  // (e.g. a rotated/expired Mailgun/HighLevel key). A per-message failure only
  // increments `failed`, so without this the route would return a healthy 200
  // with {sent:0, failed:N} buried in the body while all client mail/SMS silently
  // stopped.
  const emailDown = email.sent === 0 && email.failed > 0;
  const smsDown = sms.sent === 0 && sms.failed > 0;

  // Fail the cron (500) on either a query/fetch error OR a total send failure, so
  // the scheduler / uptime check sees it.
  const errors = [
    email.error && `email: ${email.error}`,
    sms.error && `sms: ${sms.error}`,
    inbox.error && `inbox: ${inbox.error}`,
    emailDown && `email: all ${email.failed} send(s) failed (0 sent)`,
    smsDown && `sms: all ${sms.failed} send(s) failed (0 sent)`,
  ].filter(Boolean);

  // Best-effort in-app alert on a total outage so staff notice even without an
  // external HTTP monitor. Rate-limited to once / 30 min so a sustained outage
  // (this cron runs every minute) doesn't flood the notification bell.
  if (emailDown || smsDown) {
    if (!(await isRateLimited(admin, "alert:outbox_down", "global", 1, 30 * 60 * 1000))) {
      await recordRateHit(admin, "alert:outbox_down", "global", 30 * 60 * 1000);
      const parts = [
        emailDown && `email: ${email.failed} failed, 0 sent`,
        smsDown && `sms: ${sms.failed} failed, 0 sent`,
      ].filter(Boolean);
      try {
        await admin.rpc("create_notification", {
          p_type: "system_alert",
          p_title: "Outgoing messages are failing",
          p_body: `${parts.join(" · ")} — check the Mailgun / HighLevel keys and Email settings.`,
          p_href: "/settings/email",
        });
      } catch {
        /* alerting is best-effort — the 500 status is the reliable signal */
      }
    }
  }

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
