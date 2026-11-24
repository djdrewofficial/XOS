/* Couple-app push notifications + in-app popups / custom screens.
   Mirrors scheduled email/SMS: templates define title/body/trigger; a runs table
   dedupes; per-recipient rows queue in app_notification_log; Expo drain lives
   in processAppNotificationOutbox() and is called from /api/cron/send-outbox.

   DJ content: primary DJ = first event_staff ordered by (role ILIKE '%dj%') DESC
   then name — same as <djemployee1_*> / <dj_calendar_link>. Embed HTML is never
   resolved into email; only into authenticated screen payloads. */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendExpoPush } from "@/lib/notify";
import { zonedParts } from "@/lib/scheduledComms";
import {
  APP_NOTIF_TABS,
  applyDjMergeTags,
  appNotifTargetDate,
  deepLinkForMessage,
  deepLinkForScreen,
  deepLinkForTab,
  originsFromHtml,
  pickPrimaryDjRow,
  shouldSendAppNotifications,
  type AppNotifAudience,
  type AppNotifEmbedSource,
  type AppNotifTab,
  type AppNotifTapAction,
  type AppNotifTrigger,
  type AppScreenButton,
} from "@/lib/appNotificationsLogic";

export {
  APP_NOTIF_TABS,
  applyDjMergeTags,
  appNotifTargetDate,
  deepLinkForMessage,
  deepLinkForScreen,
  deepLinkForTab,
  shouldSendAppNotifications,
};
export type { AppNotifAudience, AppNotifEmbedSource, AppNotifTab, AppNotifTapAction, AppNotifTrigger, AppScreenButton };

export type AppNotificationScreen = {
  id: string;
  name: string;
  heading: string;
  body_html: string;
  buttons: AppScreenButton[];
  embed_source: AppNotifEmbedSource;
  custom_embed_html: string | null;
  is_active: boolean;
};

export type AppNotificationTemplate = {
  id: string;
  name: string;
  title: string;
  body: string;
  is_active: boolean;
  audience: AppNotifAudience;
  trigger_type: AppNotifTrigger;
  schedule_days: number | null;
  schedule_direction: "before" | "after" | null;
  schedule_anchor: string;
  schedule_send_time: string;
  status_ids: string[];
  sched_status_ids: string[];
  tap_action: AppNotifTapAction;
  tap_tab: string | null;
  tap_screen_id: string | null;
  show_as_popup: boolean;
  send_push: boolean;
  allow_demo_mode: boolean;
};

export type PrimaryDj = {
  employeeId: string | null;
  name: string;
  bookingUrl: string;
  bookingEmbedHtml: string;
};

export type ResolvedScreen = {
  id: string;
  name: string;
  heading: string;
  body_html: string;
  buttons: AppScreenButton[];
  embed_html: string | null;
  dj: { name: string; booking_url: string };
  render: {
    mode: "webview_sandbox";
    allowed_origins: string[];
    open_links: "external";
  };
};

const ANCHOR_COLS: Record<string, string> = {
  event_date: "event_date",
  booked_date: "booked_date",
  initial_contact_date: "initial_contact_date",
  contract_sent_date: "contract_sent_date",
  contract_due_date: "contract_due_date",
  contract_signed_date: "contract_signed_date",
  quote_sent_date: "quote_sent_date",
};

/** Primary DJ for an event — same ordering as merge tags. */
export async function resolvePrimaryDj(admin: SupabaseClient, eventId: string): Promise<PrimaryDj> {
  const [{ data: staff }, { data: company }] = await Promise.all([
    admin
      .from("event_staff")
      .select(
        "employee_id, role, employees(id, first_name, last_name, stage_name, booking_url, planning_meeting_url, booking_embed_html)",
      )
      .eq("event_id", eventId),
    admin
      .from("company_settings")
      .select("company_name, default_booking_url, default_booking_embed_html")
      .eq("id", true)
      .maybeSingle(),
  ]);

  type Emp = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    stage_name: string | null;
    booking_url: string | null;
    planning_meeting_url: string | null;
    booking_embed_html: string | null;
  };
  const rows = ((staff ?? []) as { employee_id: string; role: string | null; employees: Emp | Emp[] | null }[])
    .map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
      return emp
        ? {
            role: r.role ?? "",
            stageName: emp.stage_name,
            firstName: emp.first_name,
            emp,
          }
        : null;
    })
    .filter(Boolean) as { role: string; stageName: string | null; firstName: string | null; emp: Emp }[];

  const pick = pickPrimaryDjRow(rows)?.emp ?? null;
  const companyName = (company?.company_name as string | null) ?? "Xpress Entertainment";
  const defaultUrl = (company?.default_booking_url as string | null) ?? "";
  const defaultEmbed = (company?.default_booking_embed_html as string | null) ?? "";

  if (!pick) {
    return {
      employeeId: null,
      name: companyName,
      bookingUrl: defaultUrl,
      bookingEmbedHtml: defaultEmbed,
    };
  }

  const name =
    (pick.stage_name && pick.stage_name.trim()) ||
    [pick.first_name, pick.last_name].filter(Boolean).join(" ").trim() ||
    companyName;

  return {
    employeeId: pick.id,
    name,
    bookingUrl:
      (pick.booking_url && pick.booking_url.trim()) ||
      (pick.planning_meeting_url && pick.planning_meeting_url.trim()) ||
      defaultUrl,
    bookingEmbedHtml: (pick.booking_embed_html && pick.booking_embed_html.trim()) || defaultEmbed,
  };
}

export async function renderAppNotifText(
  admin: SupabaseClient,
  eventId: string,
  template: string,
  dj?: PrimaryDj,
): Promise<string> {
  const { data } = await admin.rpc("render_merge_tags", { p_event_id: eventId, p_template: template });
  const base = typeof data === "string" ? data : template;
  const primary = dj ?? (await resolvePrimaryDj(admin, eventId));
  return applyDjMergeTags(base, primary, { allowEmbed: false });
}

export async function resolveScreenForEvent(
  admin: SupabaseClient,
  screenId: string,
  eventId: string,
): Promise<ResolvedScreen | null> {
  const { data: screen } = await admin
    .from("app_notification_screens")
    .select("id, name, heading, body_html, buttons, embed_source, custom_embed_html, is_active")
    .eq("id", screenId)
    .maybeSingle();
  if (!screen || !screen.is_active) return null;

  const dj = await resolvePrimaryDj(admin, eventId);
  const heading = await renderAppNotifText(admin, eventId, screen.heading ?? "", dj);
  const body_html = await renderAppNotifText(admin, eventId, screen.body_html ?? "", dj);

  let embed_html: string | null = null;
  if (screen.embed_source === "dj_booking_embed") {
    embed_html = dj.bookingEmbedHtml || null;
  } else if (screen.embed_source === "custom_html" && screen.custom_embed_html) {
    embed_html = applyDjMergeTags(screen.custom_embed_html, dj, { allowEmbed: true });
  }

  const buttons = Array.isArray(screen.buttons) ? (screen.buttons as AppScreenButton[]) : [];

  return {
    id: screen.id,
    name: screen.name,
    heading,
    body_html,
    buttons,
    embed_html,
    dj: { name: dj.name, booking_url: dj.bookingUrl },
    render: {
      mode: "webview_sandbox",
      allowed_origins: embed_html ? originsFromHtml(embed_html) : [],
      open_links: "external",
    },
  };
}

type Recipient = { authUserId: string; role: "host" | "guest" };

export async function resolveAppNotifRecipients(
  admin: SupabaseClient,
  eventId: string,
  audience: AppNotifAudience,
): Promise<Recipient[]> {
  const wantHosts = audience === "hosts" || audience === "hosts_and_guests";
  const wantGuests = audience === "guests" || audience === "hosts_and_guests";
  const byUser = new Map<string, Recipient>();

  const { data: members } = await admin.from("event_app_members").select("auth_user_id, role").eq("event_id", eventId);
  for (const m of (members ?? []) as { auth_user_id: string; role: string }[]) {
    if (m.role === "host" && wantHosts) byUser.set(m.auth_user_id, { authUserId: m.auth_user_id, role: "host" });
    if (m.role === "guest" && wantGuests) byUser.set(m.auth_user_id, { authUserId: m.auth_user_id, role: "guest" });
  }

  if (wantHosts) {
    const [{ data: ev }, { data: ecs }] = await Promise.all([
      admin.from("events").select("client_id").eq("id", eventId).maybeSingle(),
      admin.from("event_clients").select("client_id").eq("event_id", eventId),
    ]);
    const clientIds = new Set<string>();
    if (ev?.client_id) clientIds.add(ev.client_id as string);
    for (const row of ecs ?? []) if (row.client_id) clientIds.add(row.client_id as string);
    if (clientIds.size) {
      const { data: accts } = await admin
        .from("accounts")
        .select("auth_user_id, client_id")
        .in("client_id", [...clientIds])
        .eq("account_type", "client");
      for (const a of (accts ?? []) as { auth_user_id: string }[]) {
        if (!byUser.has(a.auth_user_id)) byUser.set(a.auth_user_id, { authUserId: a.auth_user_id, role: "host" });
      }
    }
  }

  return [...byUser.values()];
}

async function loadEventGate(admin: SupabaseClient, eventId: string) {
  const { data: ev } = await admin
    .from("events")
    .select(
      "archived_at, demo_mode, status_id, event_date, booked_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date, event_statuses(name, is_lost_sale_group)",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return null;
  const st = ev.event_statuses as
    | { name?: string; is_lost_sale_group?: boolean }
    | { name?: string; is_lost_sale_group?: boolean }[]
    | null;
  const status = Array.isArray(st) ? st[0] : st;
  return {
    archived_at: (ev.archived_at as string | null) ?? null,
    demo_mode: Boolean(ev.demo_mode),
    status_id: (ev.status_id as string | null) ?? null,
    status_name: status?.name ?? null,
    is_lost_sale_group: Boolean(status?.is_lost_sale_group),
    anchors: {
      event_date: (ev.event_date as string | null) ?? null,
      booked_date: (ev.booked_date as string | null) ?? null,
      initial_contact_date: (ev.initial_contact_date as string | null) ?? null,
      contract_sent_date: (ev.contract_sent_date as string | null) ?? null,
      contract_due_date: (ev.contract_due_date as string | null) ?? null,
      contract_signed_date: (ev.contract_signed_date as string | null) ?? null,
      quote_sent_date: (ev.quote_sent_date as string | null) ?? null,
    },
  };
}

async function queueForRecipients(
  admin: SupabaseClient,
  opts: {
    template: AppNotificationTemplate;
    eventId: string;
    recipients: Recipient[];
    dedupePrefix: string;
  },
): Promise<{ queued: number; ids: string[] }> {
  const dj = await resolvePrimaryDj(admin, opts.eventId);
  const title = await renderAppNotifText(admin, opts.eventId, opts.template.title, dj);
  const body = await renderAppNotifText(admin, opts.eventId, opts.template.body, dj);

  const prefsRows = opts.recipients.length
    ? (
        await admin
          .from("app_notification_prefs")
          .select("auth_user_id, push_enabled, popup_enabled")
          .in(
            "auth_user_id",
            opts.recipients.map((r) => r.authUserId),
          )
      ).data
    : [];
  const prefs = new Map(
    ((prefsRows ?? []) as { auth_user_id: string; push_enabled: boolean; popup_enabled: boolean }[]).map((p) => [
      p.auth_user_id,
      p,
    ]),
  );

  const ids: string[] = [];
  for (const r of opts.recipients) {
    const pref = prefs.get(r.authUserId);
    const pushOk = pref?.push_enabled !== false;
    const popupOk = pref?.popup_enabled !== false;
    if (!pushOk && !popupOk) continue;
    if (!opts.template.send_push && !opts.template.show_as_popup) continue;

    const id = crypto.randomUUID();
    const deep_link =
      opts.template.tap_action === "screen" && opts.template.tap_screen_id
        ? deepLinkForScreen(opts.template.tap_screen_id)
        : opts.template.tap_action === "tab" && opts.template.tap_tab
          ? deepLinkForTab(opts.template.tap_tab)
          : deepLinkForMessage(id);

    const row = {
      id,
      template_id: opts.template.id,
      screen_id: opts.template.tap_screen_id,
      event_id: opts.eventId,
      auth_user_id: r.authUserId,
      audience_role: r.role,
      title,
      body,
      tap_action: opts.template.tap_action,
      tap_tab: opts.template.tap_tab,
      deep_link,
      show_as_popup: opts.template.show_as_popup && popupOk,
      send_push: opts.template.send_push && pushOk,
      status: "queued",
      dedupe_key: `${opts.dedupePrefix}:${r.authUserId}`,
    };
    const { error } = await admin.from("app_notification_log").insert(row);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) continue;
      throw new Error(error.message);
    }
    ids.push(id);
  }
  return { queued: ids.length, ids };
}

export async function queueAppNotificationTemplate(
  admin: SupabaseClient,
  templateId: string,
  eventId: string,
  opts: { triggerKey?: string; force?: boolean } = {},
): Promise<{ queued: number; skipped?: string; ids: string[] }> {
  const { data: tpl } = await admin.from("app_notification_templates").select("*").eq("id", templateId).maybeSingle();
  if (!tpl) return { queued: 0, skipped: "template_missing", ids: [] };
  const template = tpl as AppNotificationTemplate;
  if (!template.is_active && !opts.force) return { queued: 0, skipped: "inactive", ids: [] };

  const gate = await loadEventGate(admin, eventId);
  if (!gate) return { queued: 0, skipped: "event_missing", ids: [] };
  const send = shouldSendAppNotifications({
    ...gate,
    allow_demo_mode: template.allow_demo_mode,
  });
  if (!send.ok) return { queued: 0, skipped: send.reason, ids: [] };

  const triggerKey = opts.triggerKey ?? `manual:${new Date().toISOString().slice(0, 10)}`;
  if (!opts.force) {
    const { data: existing } = await admin
      .from("app_notification_runs")
      .select("id, status")
      .eq("template_id", templateId)
      .eq("event_id", eventId)
      .eq("trigger_key", triggerKey)
      .maybeSingle();
    if (existing && existing.status !== "pending") {
      return { queued: 0, skipped: `already_${existing.status}`, ids: [] };
    }
  }

  const recipients = await resolveAppNotifRecipients(admin, eventId, template.audience);
  if (recipients.length === 0) {
    await admin.from("app_notification_runs").upsert(
      { template_id: templateId, event_id: eventId, trigger_key: triggerKey, status: "sent" },
      { onConflict: "template_id,event_id,trigger_key" },
    );
    return { queued: 0, skipped: "no_recipients", ids: [] };
  }

  const result = await queueForRecipients(admin, {
    template,
    eventId,
    recipients,
    dedupePrefix: `${templateId}:${eventId}:${triggerKey}`,
  });

  await admin.from("app_notification_runs").upsert(
    { template_id: templateId, event_id: eventId, trigger_key: triggerKey, status: "sent" },
    { onConflict: "template_id,event_id,trigger_key" },
  );
  return result;
}

export async function runAppNotificationsOnStatusChange(
  admin: SupabaseClient,
  eventId: string,
  statusId: string,
): Promise<{ templates: number; queued: number }> {
  const { data: templates } = await admin
    .from("app_notification_templates")
    .select("*")
    .eq("is_active", true)
    .eq("trigger_type", "status_change");
  let queued = 0;
  let matched = 0;
  for (const raw of templates ?? []) {
    const t = raw as AppNotificationTemplate;
    if (!(t.status_ids ?? []).includes(statusId)) continue;
    matched++;
    const r = await queueAppNotificationTemplate(admin, t.id, eventId, { triggerKey: `status:${statusId}` });
    queued += r.queued;
  }
  return { templates: matched, queued };
}

export async function queueAppNotificationsFromHelperActions(
  admin: SupabaseClient,
  eventId: string,
  actions: { type?: string; template_id?: string }[],
): Promise<{ queued: number }> {
  let queued = 0;
  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (act?.type !== "send_app_notification" || !act.template_id) continue;
    const r = await queueAppNotificationTemplate(admin, act.template_id, eventId, {
      triggerKey: `helper:${act.template_id}:${i}`,
    });
    queued += r.queued;
  }
  return { queued };
}

export async function runScheduledAppNotifications(
  admin: SupabaseClient,
): Promise<{ matched: number; queued: number; skipped: number }> {
  const { data: settings } = await admin.from("company_settings").select("timezone").eq("id", true).maybeSingle();
  const tz = (settings?.timezone as string) || "America/New_York";
  const parts = zonedParts(new Date(), tz);
  const today = parts.date;
  const nowHm = parts.time.slice(0, 5);

  const { data: templates } = await admin
    .from("app_notification_templates")
    .select("*")
    .eq("is_active", true)
    .eq("trigger_type", "schedule");

  let matched = 0;
  let queued = 0;
  let skipped = 0;

  // Static column list so the Supabase client can type the select.
  const { data: events } = await admin
    .from("events")
    .select(
      "id, archived_at, demo_mode, status_id, event_date, booked_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date, event_statuses(name, is_lost_sale_group)",
    )
    .is("archived_at", null)
    .limit(2000);

  for (const raw of templates ?? []) {
    const t = raw as AppNotificationTemplate;
    if (t.schedule_days == null || !t.schedule_direction) continue;
    const sendTime = (t.schedule_send_time || "09:00:00").toString().slice(0, 5);
    if (nowHm < sendTime) continue;

    const anchorCol = ANCHOR_COLS[t.schedule_anchor] ?? "event_date";

    for (const ev of events ?? []) {
      const anchor = (ev as Record<string, unknown>)[anchorCol] as string | null;
      if (!anchor) continue;
      const target = appNotifTargetDate({
        anchorDate: anchor,
        days: t.schedule_days,
        direction: t.schedule_direction,
      });
      if (target !== today) continue;

      if ((t.sched_status_ids?.length ?? 0) > 0 && ev.status_id && !t.sched_status_ids.includes(ev.status_id as string)) {
        skipped++;
        continue;
      }

      const st = ev.event_statuses as
        | { name?: string; is_lost_sale_group?: boolean }
        | { name?: string; is_lost_sale_group?: boolean }[]
        | null;
      const status = Array.isArray(st) ? st[0] : st;
      const gate = shouldSendAppNotifications({
        archived_at: null,
        demo_mode: Boolean(ev.demo_mode),
        status_name: status?.name ?? null,
        is_lost_sale_group: Boolean(status?.is_lost_sale_group),
        allow_demo_mode: t.allow_demo_mode,
      });
      if (!gate.ok) {
        skipped++;
        continue;
      }

      matched++;
      const r = await queueAppNotificationTemplate(admin, t.id, ev.id as string, { triggerKey: target });
      queued += r.queued;
      if (r.skipped) skipped++;
    }
  }

  return { matched, queued, skipped };
}

export async function processAppNotificationOutbox(
  admin: SupabaseClient,
  limit = 50,
): Promise<{ sent: number; failed: number; error?: string }> {
  const { data: rows, error } = await admin
    .from("app_notification_log")
    .select("id, auth_user_id, title, body, deep_link, send_push, show_as_popup, status")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(limit);
  if (error) return { sent: 0, failed: 0, error: error.message };

  let sent = 0;
  let failed = 0;

  for (const row of (rows ?? []) as {
    id: string;
    auth_user_id: string;
    title: string;
    body: string;
    deep_link: string;
    send_push: boolean;
    show_as_popup: boolean;
  }[]) {
    try {
      if (row.send_push) {
        const { data: tokens } = await admin
          .from("app_device_tokens")
          .select("expo_push_token")
          .eq("auth_user_id", row.auth_user_id)
          .eq("is_active", true);
        const list = ((tokens ?? []) as { expo_push_token: string }[])
          .map((t) => t.expo_push_token)
          .filter(Boolean);
        if (list.length) {
          await sendExpoPush(
            list.map((to) => ({
              to,
              title: row.title,
              body: row.body,
              sound: "default",
              data: { deepLink: row.deep_link, messageId: row.id },
            })),
          );
        }
      }
      await admin
        .from("app_notification_log")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "queued");
      sent++;
    } catch (err) {
      failed++;
      await admin
        .from("app_notification_log")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq("id", row.id)
        .eq("status", "queued");
    }
  }

  return { sent, failed };
}

export async function listPendingAppMessages(admin: SupabaseClient, authUserId: string, eventId: string) {
  const { data } = await admin
    .from("app_notification_log")
    .select(
      "id, title, body, deep_link, tap_action, tap_tab, screen_id, show_as_popup, status, queued_at, sent_at, opened_at, dismissed_at",
    )
    .eq("auth_user_id", authUserId)
    .eq("event_id", eventId)
    .in("status", ["queued", "sent", "opened"])
    .order("queued_at", { ascending: false })
    .limit(50);

  const messages = (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    deep_link: r.deep_link as string,
    tap_action: r.tap_action as string,
    tap_tab: (r.tap_tab as string | null) ?? null,
    screen_id: (r.screen_id as string | null) ?? null,
    show_as_popup: Boolean(r.show_as_popup),
    status: r.status as string,
    queued_at: r.queued_at as string,
    sent_at: (r.sent_at as string | null) ?? null,
  }));

  const popups = messages
    .filter((m) => {
      const raw = (data ?? []).find((d) => d.id === m.id);
      return m.show_as_popup && (m.status === "sent" || m.status === "queued") && !raw?.dismissed_at && !raw?.opened_at;
    })
    .map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      deep_link: m.deep_link,
      screen_id: m.screen_id,
    }));

  return { messages, popups };
}

export async function markAppNotification(
  admin: SupabaseClient,
  authUserId: string,
  messageId: string,
  action: "opened" | "dismissed",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await admin
    .from("app_notification_log")
    .select("id, auth_user_id, status")
    .eq("id", messageId)
    .maybeSingle();
  if (!row || row.auth_user_id !== authUserId) return { ok: false, error: "not_found" };

  const patch =
    action === "opened"
      ? { status: "opened", opened_at: new Date().toISOString() }
      : { status: "dismissed", dismissed_at: new Date().toISOString() };

  const { error } = await admin.from("app_notification_log").update(patch).eq("id", messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function previewAppNotification(admin: SupabaseClient, templateId: string, eventId: string) {
  const { data: tpl } = await admin.from("app_notification_templates").select("*").eq("id", templateId).maybeSingle();
  if (!tpl) throw new Error("Template not found.");
  const template = tpl as AppNotificationTemplate;
  const gateEv = await loadEventGate(admin, eventId);
  if (!gateEv) throw new Error("Event not found.");
  const gate = shouldSendAppNotifications({ ...gateEv, allow_demo_mode: template.allow_demo_mode });
  const dj = await resolvePrimaryDj(admin, eventId);
  const title = await renderAppNotifText(admin, eventId, template.title, dj);
  const body = await renderAppNotifText(admin, eventId, template.body, dj);
  const screen =
    template.tap_action === "screen" && template.tap_screen_id
      ? await resolveScreenForEvent(admin, template.tap_screen_id, eventId)
      : null;
  const recipients = await resolveAppNotifRecipients(admin, eventId, template.audience);
  return { title, body, dj, screen, recipients, gate };
}
