/* Send App Demo — turn Demo Mode on (if needed), ensure a host join link,
   then email + text the client with the join link and iPhone App Store URL.
   Uses the same email_log / sms_log outbox and consent gates as other sends. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enableEventDemoMode, type DemoModeResult } from "@/lib/demoMode";
import { ensureJoinLinks } from "@/lib/eventAccessServer";
import {
  SEND_APP_DEMO_EMAIL,
  SEND_APP_DEMO_EMAIL_TEMPLATE_ID,
  SEND_APP_DEMO_SMS,
  SEND_APP_DEMO_SMS_TEMPLATE_ID,
  XPRESS_IOS_APP_STORE_URL,
} from "@/lib/demoModeCopy";
import { placeJoinLinkTags, placeAppStoreLink } from "@/lib/eventAccess";
import { isPhoneOptedOut } from "@/lib/smsOptOut";

export type SendAppDemoResult =
  | {
      ok: true;
      demo_mode: true;
      already_demo?: boolean;
      host_join_url: string;
      email_queued: boolean;
      sms_queued: boolean;
      warnings: string[];
    }
  | { ok: false; error: string; code?: string };

/** Refuse Cancelled / lost-sale / archived events (same family of safeguards). */
export async function eventBlocksDemoComms(
  admin: SupabaseClient,
  eventId: string,
): Promise<{ blocked: true; error: string; code: string } | { blocked: false; event: EventLite }> {
  const { data: event, error } = await admin
    .from("events")
    .select(
      "id, client_id, demo_mode, archived_at, status_id, status:event_statuses(name, is_lost_sale_group)",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) return { blocked: true, error: error.message, code: "ERROR" };
  if (!event) return { blocked: true, error: "Event not found.", code: "NOT_FOUND" };
  if (event.archived_at) {
    return { blocked: true, error: "This event is archived.", code: "ARCHIVED" };
  }
  const status = event.status as { name?: string | null; is_lost_sale_group?: boolean | null } | null;
  if (status?.is_lost_sale_group || status?.name === "Cancelled") {
    return { blocked: true, error: "Demo Mode is not available for cancelled or lost-sale events.", code: "CANCELLED" };
  }
  return {
    blocked: false,
    event: {
      id: event.id as string,
      client_id: (event.client_id as string | null) ?? null,
      demo_mode: Boolean(event.demo_mode),
    },
  };
}

type EventLite = { id: string; client_id: string | null; demo_mode: boolean };

async function resolveTemplateId(
  admin: SupabaseClient,
  preferredId: string,
  name: string,
  isSms: boolean,
): Promise<string | null> {
  const byId = await admin
    .from("email_templates")
    .select("id")
    .eq("id", preferredId)
    .eq("is_active", true)
    .maybeSingle();
  if (byId.data?.id) return byId.data.id as string;
  const byName = await admin
    .from("email_templates")
    .select("id")
    .eq("name", name)
    .eq("is_sms", isSms)
    .eq("is_active", true)
    .maybeSingle();
  return (byName.data?.id as string | null) ?? null;
}

async function renderTags(admin: SupabaseClient, eventId: string, template: string): Promise<string> {
  const { data, error } = await admin.rpc("render_merge_tags", { p_event_id: eventId, p_template: template });
  if (error) throw new Error(error.message);
  return (data as string) ?? template;
}

/**
 * Enable Demo Mode (idempotent), ensure host join link, queue warm email + SMS.
 * SMS follows STOP / marketing consent via processSmsOutbox when drained.
 * Set drain=false when a caller (e.g. executeBookingHelper) drains afterward.
 */
export async function sendAppDemo(
  eventId: string,
  opts: { force?: boolean; drain?: boolean } = {},
): Promise<SendAppDemoResult> {
  const admin = createAdminClient();
  const gate = await eventBlocksDemoComms(admin, eventId);
  if (gate.blocked) return { ok: false, error: gate.error, code: gate.code };

  const warnings: string[] = [];
  let enableResult: DemoModeResult | null = null;
  if (!gate.event.demo_mode) {
    enableResult = await enableEventDemoMode(eventId, { force: opts.force === true });
    if (!enableResult.ok) return { ok: false, error: enableResult.error, code: enableResult.code };
  }

  let hostUrl = "";
  try {
    const links = await ensureJoinLinks(admin, eventId, null);
    hostUrl = links.find((l) => l.role === "host")?.url ?? "";
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create the host join link.",
      code: "JOIN_LINK",
    };
  }
  if (!hostUrl) {
    return { ok: false, error: "Could not create the host join link.", code: "JOIN_LINK" };
  }

  const { data: client } = gate.event.client_id
    ? await admin
        .from("clients")
        .select("id, email, cell_phone, first_name")
        .eq("id", gate.event.client_id)
        .maybeSingle()
    : { data: null };

  const emailTplId = await resolveTemplateId(
    admin,
    SEND_APP_DEMO_EMAIL_TEMPLATE_ID,
    SEND_APP_DEMO_EMAIL.name,
    false,
  );
  const smsTplId = await resolveTemplateId(
    admin,
    SEND_APP_DEMO_SMS_TEMPLATE_ID,
    SEND_APP_DEMO_SMS.name,
    true,
  );

  let emailQueued = false;
  let smsQueued = false;
  const queuedSince = new Date().toISOString();

  // --- Email ---
  const toEmail = (client?.email ?? "").trim();
  if (!toEmail) {
    warnings.push("No client email on file — email skipped.");
  } else {
    let subject = SEND_APP_DEMO_EMAIL.subject;
    let body = SEND_APP_DEMO_EMAIL.bodyHtml;
    if (emailTplId) {
      const { data: tpl } = await admin
        .from("email_templates")
        .select("subject, body_html")
        .eq("id", emailTplId)
        .maybeSingle();
      if (tpl) {
        subject = (tpl.subject as string) || subject;
        body = (tpl.body_html as string) || body;
      }
    }
    subject = await renderTags(admin, eventId, subject);
    body = await renderTags(admin, eventId, body);
    body = placeJoinLinkTags(body, { host: hostUrl, guest: null });
    body = placeAppStoreLink(body, XPRESS_IOS_APP_STORE_URL);
    subject = placeAppStoreLink(placeJoinLinkTags(subject, { host: hostUrl }), XPRESS_IOS_APP_STORE_URL);

    const { data: senderRaw } = await admin.rpc("resolve_sender", {
      p_event_id: eventId,
      p_from: "company",
    });
    const sender =
      senderRaw && typeof senderRaw === "object"
        ? (senderRaw as { name?: string; email?: string; reply_to?: string })
        : {};
    const { error } = await admin.from("email_log").insert({
      event_id: eventId,
      client_id: gate.event.client_id,
      template_id: emailTplId,
      to_address: toEmail,
      from_name: sender.name ?? null,
      from_address: sender.email ?? null,
      reply_to: sender.reply_to ?? null,
      subject,
      body_html: body,
      status: "queued",
      bypass_comms_pause: true,
    });
    if (error) warnings.push(`Email queue failed: ${error.message}`);
    else emailQueued = true;
  }

  // --- SMS (transactional; STOP still honored at drain) ---
  const toPhone = (client?.cell_phone ?? "").trim();
  if (!toPhone) {
    warnings.push("No client cell on file — text skipped.");
  } else if (await isPhoneOptedOut(admin, toPhone)) {
    warnings.push("Client phone is opted out (STOP) — text skipped.");
  } else {
    let smsBody = SEND_APP_DEMO_SMS.bodyHtml;
    let isMarketing = false;
    if (smsTplId) {
      const { data: tpl } = await admin
        .from("email_templates")
        .select("body_html, sms_marketing")
        .eq("id", smsTplId)
        .maybeSingle();
      if (tpl?.body_html) {
        const { data: plain } = await admin.rpc("xos_html_to_sms", {
          p_html: await renderTags(admin, eventId, tpl.body_html as string),
        });
        smsBody = (plain as string) || smsBody;
        isMarketing = Boolean(tpl.sms_marketing);
      }
    } else {
      smsBody = await renderTags(admin, eventId, smsBody);
    }
    smsBody = placeJoinLinkTags(smsBody, { host: hostUrl, guest: null });
    smsBody = placeAppStoreLink(smsBody, XPRESS_IOS_APP_STORE_URL);

    const { error } = await admin.from("sms_log").insert({
      event_id: eventId,
      client_id: gate.event.client_id,
      to_number: toPhone,
      body: smsBody,
      status: "queued",
      is_marketing: isMarketing,
      bypass_comms_pause: true,
    });
    if (error) warnings.push(`SMS queue failed: ${error.message}`);
    else smsQueued = true;
  }

  if (!emailQueued && !smsQueued) {
    return {
      ok: false,
      error: warnings[0] ?? "Nothing to send — add a client email or cell first.",
      code: "NO_RECIPIENT",
    };
  }

  if (opts.drain !== false) {
    const [{ drainEventOutbox }] = await Promise.all([import("@/lib/scopedOutbox")]);
    await drainEventOutbox(admin, eventId, queuedSince);
  }

  return {
    ok: true,
    demo_mode: true,
    already_demo: enableResult?.already === true || gate.event.demo_mode,
    host_join_url: hostUrl,
    email_queued: emailQueued,
    sms_queued: smsQueued,
    warnings,
  };
}
