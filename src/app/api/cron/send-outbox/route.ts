import { NextResponse } from "next/server";
import { processOutbox, cleanupOutboxTmp } from "@/lib/mailgun";
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

  // --- pg_cron liveness backstop -------------------------------------------
  // The three queueing engines (scheduled emails every 15 min, payment reminders +
  // daily status actions once a day) are registered ONLY through pg_cron, which can
  // silently stop after a restore — and nothing errors. Using pg_cron's own run log
  // (cron_job_health, migration 00174), run any engine it has missed and alert. This
  // cron is driven by an external scheduler (independent of pg_cron), so it keeps
  // queueing alive even if pg_cron is dead. The engines self-dedupe
  // (scheduled_email_runs / payment_reminder_sends / idempotent status writes) and
  // advisory-lock, so a redundant backstop run is safe. An empty cron.job (the usual
  // post-restore state) yields no rows → every engine reads as stale → all backstop.
  const cronMisses: string[] = [];
  try {
    const { data: health } = await admin.rpc("cron_job_health");
    const byName = new Map(
      ((health ?? []) as Array<{ jobname: string; active: boolean; minutes_since: number | string | null }>).map(
        (h) => [h.jobname, h],
      ),
    );
    // job → engine RPC + how stale (minutes) counts as a miss.
    const ENGINES = [
      { job: "xos-scheduled-emails", rpc: "run_scheduled_emails", staleMin: 20 },
      { job: "xos-payment-reminders", rpc: "run_payment_reminders", staleMin: 25 * 60 },
      { job: "xos-daily-status-actions", rpc: "run_daily_status_actions", staleMin: 25 * 60 },
    ] as const;
    for (const e of ENGINES) {
      const row = byName.get(e.job);
      const mins = row && row.minutes_since != null ? Number(row.minutes_since) : null;
      // job row absent, disabled, never-run, or overdue → pg_cron isn't running it
      const stale = !row || row.active === false || mins === null || mins > e.staleMin;
      if (!stale) continue;
      cronMisses.push(`${e.job} (${mins === null ? "no run logged" : `${Math.round(mins)}m ago`})`);
      try {
        await admin.rpc(e.rpc); // self-deduping engine; safe to run as a backstop
      } catch {
        cronMisses.push(`${e.job}: backstop run failed`);
      }
    }
  } catch {
    /* probe missing/erroring — never fail the outbox drain over the liveness check */
  }

  // Alert (rate-limited to once / 30 min) when pg_cron has missed a cycle, so the
  // office knows to re-enable it. The backstop above covers the gap meanwhile.
  if (cronMisses.length) {
    if (!(await isRateLimited(admin, "alert:cron_stalled", "global", 1, 30 * 60 * 1000))) {
      await recordRateHit(admin, "alert:cron_stalled", "global", 30 * 60 * 1000);
      try {
        await admin.rpc("create_notification", {
          p_type: "system_alert",
          p_title: "Scheduled jobs (pg_cron) may have stopped",
          p_body: `Backstopped: ${cronMisses.join(" · ")}. Check cron.job in Supabase — reminders & scheduled emails won't queue on their own until it's running again.`,
          p_href: "/settings",
        });
      } catch {
        /* best-effort — the cronMisses in the response body is the reliable signal */
      }
    }
  }

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

  // Once a day, prune expired HighLevel-attachment temp files (outbox-tmp/) so
  // Storage doesn't grow unbounded. Rate-limited so only one of the frequent cron
  // ticks does the work; best-effort so it never affects the drain result.
  let tmpCleaned: number | undefined;
  if (!(await isRateLimited(admin, "cleanup:outbox_tmp", "global", 1, 24 * 60 * 60 * 1000))) {
    await recordRateHit(admin, "cleanup:outbox_tmp", "global", 24 * 60 * 60 * 1000);
    try {
      tmpCleaned = (await cleanupOutboxTmp(admin)).deleted;
    } catch {
      /* best-effort */
    }
  }

  const status = errors.length ? 500 : 200;
  return NextResponse.json(
    {
      email,
      sms,
      inbox,
      ...(cronMisses.length ? { cronMisses } : {}),
      ...(tmpCleaned ? { tmpCleaned } : {}),
      ...(errors.length ? { errors } : {}),
    },
    { status },
  );
}

export async function POST(req: Request) {
  return run(req);
}

// Allow GET too, so simple cron services that only do GET can trigger it.
export async function GET(req: Request) {
  return run(req);
}
