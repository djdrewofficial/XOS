import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordXosEmailInComms } from "@/lib/highlevel";
import { deriveCommsSource } from "@/lib/emailCommsLog";

/* Idempotent backfill: re-run the shared Comms/GHL logging step for past
   email_log sends that are missing a local hl_messages mirror and/or have a
   failed/pending ghl_sync_status. Does NOT re-send email or SMS.

   Auth: Bearer CRON_SECRET or cron_auth token (same as /api/cron/send-outbox).
   Query:
     dry_run=1   (default) — report what would be processed, write nothing
     dry_run=0   — actually write Comms mirrors + attempt GHL log
     limit=50    — max rows (capped at 200)
     since=ISO   — only rows with sent_at >= since (default 90 days ago)
*/

export const dynamic = "force-dynamic";

async function authorized(req: Request, admin: SupabaseClient): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const { data } = await admin.from("cron_auth").select("token").limit(1).maybeSingle();
  return !!data?.token && token === data.token;
}

async function run(req: Request) {
  const admin = createAdminClient();
  if (!(await authorized(req, admin))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") !== "0";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "invalid since" }, { status: 400 });
  }

  // Candidates: client-facing sent mail with an event, missing mirror OR ghl pending/failed.
  const { data: rows, error } = await admin
    .from("email_log")
    .select(
      "id, event_id, client_id, template_id, helper_id, to_address, from_name, from_address, subject, body_html, sent_at, status, ghl_sync_status, bypass_comms_pause, provider_message_id",
    )
    .in("status", ["sent", "delivered", "opened"])
    .not("to_address", "is", null)
    .not("event_id", "is", null)
    .gte("sent_at", since.toISOString())
    .order("sent_at", { ascending: false })
    .limit(limit * 3); // over-fetch then filter by mirror/ghl status

  if (error && /column|schema cache/i.test(error.message)) {
    // Pre-00236 schema: select without new columns.
    const legacy = await admin
      .from("email_log")
      .select(
        "id, event_id, client_id, template_id, to_address, from_name, from_address, subject, body_html, sent_at, status, bypass_comms_pause, provider_message_id",
      )
      .in("status", ["sent", "delivered", "opened"])
      .not("to_address", "is", null)
      .not("event_id", "is", null)
      .gte("sent_at", since.toISOString())
      .order("sent_at", { ascending: false })
      .limit(limit * 3);
    if (legacy.error) {
      return NextResponse.json({ error: legacy.error.message }, { status: 500 });
    }
    return processRows(admin, legacy.data ?? [], { dryRun, limit });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return processRows(admin, rows ?? [], { dryRun, limit });
}

async function processRows(
  admin: SupabaseClient,
  rows: Record<string, unknown>[],
  opts: { dryRun: boolean; limit: number },
) {
  const ids = rows.map((r) => r.id as string);
  const mirrorIds = ids.map((id) => `xos-email-${id}`);
  const { data: mirrors } = mirrorIds.length
    ? await admin.from("hl_messages").select("id").in("id", mirrorIds)
    : { data: [] as { id: string }[] };
  const haveMirror = new Set((mirrors ?? []).map((m) => m.id as string));

  const candidates = rows.filter((r) => {
    const id = r.id as string;
    const missingMirror = !haveMirror.has(`xos-email-${id}`);
    const sync = (r.ghl_sync_status as string | null | undefined) ?? null;
    const ghlNeedsWork = sync === "pending" || sync === "failed" || sync == null;
    return missingMirror || ghlNeedsWork;
  }).slice(0, opts.limit);

  const templateIds = [
    ...new Set(candidates.map((r) => r.template_id as string | null).filter((id): id is string => !!id)),
  ];
  const { data: templates } = templateIds.length
    ? await admin.from("email_templates").select("id, name, schedule_enabled").in("id", templateIds)
    : { data: [] as { id: string; name: string; schedule_enabled: boolean }[] };
  const tplById = new Map((templates ?? []).map((t) => [t.id as string, t]));

  if (opts.dryRun) {
    return NextResponse.json({
      dry_run: true,
      would_process: candidates.length,
      sample: candidates.slice(0, 20).map((r) => ({
        id: r.id,
        event_id: r.event_id,
        to_address: r.to_address,
        subject: r.subject,
        missing_mirror: !haveMirror.has(`xos-email-${r.id as string}`),
        ghl_sync_status: r.ghl_sync_status ?? null,
      })),
      hint: "Pass dry_run=0 to write Comms mirrors and attempt GHL logging. Does not re-send mail.",
    });
  }

  let processed = 0;
  let failed = 0;
  for (const r of candidates) {
    const tpl = r.template_id ? tplById.get(r.template_id as string) : null;
    const sourceKind = deriveCommsSource({
      helperId: (r.helper_id as string | null) ?? null,
      scheduleEnabled: !!tpl?.schedule_enabled,
      bypassCommsPause: !!r.bypass_comms_pause,
    });
    try {
      await recordXosEmailInComms(admin, {
        emailLogId: r.id as string,
        toEmail: r.to_address as string,
        clientId: (r.client_id as string | null) ?? null,
        subject: (r.subject as string) || "(no subject)",
        html: (r.body_html as string) || "",
        sentAt: (r.sent_at as string) || new Date().toISOString(),
        threadedInHl: false,
        eventId: (r.event_id as string | null) ?? null,
        fromName: (r.from_name as string | null) ?? null,
        fromEmail: (r.from_address as string | null) ?? null,
        helperId: (r.helper_id as string | null) ?? null,
        templateId: (r.template_id as string | null) ?? null,
        templateName: (tpl?.name as string | null) ?? null,
        sourceKind,
      });
      processed++;
    } catch (err) {
      failed++;
      console.error("backfill-email-comms row failed:", r.id, err);
    }
  }

  return NextResponse.json({
    dry_run: false,
    processed,
    failed,
    considered: candidates.length,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
