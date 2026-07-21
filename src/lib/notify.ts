import type { SupabaseClient } from "@supabase/supabase-js";

/* Unified notification dispatcher — the single fan-out for the Notification
   System (migration 00126). Given a notification type + context, it:
     1. loads the type's catalog row + enabled audience/channel settings,
     2. resolves each audience to concrete recipients (roles + event roles),
     3. renders the staff copy with merge tags, and
     4. delivers over every enabled channel: in-app bell (targeted), mobile push
        (Expo), email (email_log outbox), SMS (sms_log outbox).

   Recipients are unioned by employee across audiences, and channel flags are
   OR-ed, so a person who matches two audiences gets one of each channel. All
   delivery is best-effort — a failure in one channel never blocks the others,
   and queued email/SMS drain via the existing outbox cron. */

export type NotifyContext = {
  eventId?: string | null;
  statusId?: string | null;
  // optional explicit recipients (e.g. "the staffer who was just assigned")
  employeeIds?: string[];
};

type TypeRow = {
  key: string;
  is_client_facing: boolean;
  staff_title_tpl: string | null;
  staff_body_tpl: string | null;
  href_tpl: string | null;
  email_template_id: string | null;
  sms_template_id: string | null;
  is_active: boolean;
};

type SettingRow = {
  audience: string;
  is_enabled: boolean;
  in_app: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
};

type EmployeeLite = { id: string; email: string | null; phone: string | null; permission_tier: string | null };

type Channels = { in_app: boolean; push: boolean; email: boolean; sms: boolean };

const STATIC_ROLES = new Set(["master_admin", "admin", "salesperson", "employee"]);

/** Public entry point. Never throws — logs and swallows so callers stay simple. */
export async function dispatchNotification(
  supabase: SupabaseClient,
  typeKey: string,
  ctx: NotifyContext = {}
): Promise<void> {
  try {
    await dispatchInner(supabase, typeKey, ctx);
  } catch (err) {
    console.error(`[notify] dispatch ${typeKey} failed`, err);
  }
}

async function dispatchInner(supabase: SupabaseClient, typeKey: string, ctx: NotifyContext): Promise<void> {
  const { data: type } = await supabase
    .from("notification_types")
    .select("key, is_client_facing, staff_title_tpl, staff_body_tpl, href_tpl, email_template_id, sms_template_id, is_active")
    .eq("key", typeKey)
    .maybeSingle();
  if (!type || !(type as TypeRow).is_active) return;
  const t = type as TypeRow;

  const { data: settings } = await supabase
    .from("notification_settings")
    .select("audience, is_enabled, in_app, push, email, sms")
    .eq("type_key", typeKey)
    .eq("is_enabled", true);
  const rows = (settings ?? []) as SettingRow[];
  if (rows.length === 0) return;

  // Resolve each audience to employees, unioning channels per employee.
  const perEmployee = new Map<string, { emp: EmployeeLite; ch: Channels }>();
  const staticRoles = rows.filter((r) => STATIC_ROLES.has(r.audience));
  const eventRoleRows = rows.filter((r) => r.audience === "event_salesperson" || r.audience === "event_assigned_staff");

  // Static-role audiences → all active employees of that tier.
  if (staticRoles.length) {
    const tiers = staticRoles.map((r) => r.audience);
    const { data: emps } = await supabase
      .from("employees")
      .select("id, email, phone, permission_tier")
      .in("permission_tier", tiers)
      .eq("is_active", true);
    for (const emp of (emps ?? []) as EmployeeLite[]) {
      const r = staticRoles.find((x) => x.audience === emp.permission_tier);
      if (r) mergeRecipient(perEmployee, emp, r);
    }
  }

  // Event-relationship audiences → resolve against the event.
  if (eventRoleRows.length && ctx.eventId) {
    const { data: ev } = await supabase.from("events").select("salesperson_id").eq("id", ctx.eventId).maybeSingle();
    const spRow = eventRoleRows.find((r) => r.audience === "event_salesperson");
    if (spRow && ev?.salesperson_id) {
      const emp = await fetchEmployee(supabase, ev.salesperson_id as string);
      if (emp) mergeRecipient(perEmployee, emp, spRow);
    }
    const asRow = eventRoleRows.find((r) => r.audience === "event_assigned_staff");
    if (asRow) {
      const { data: staff } = await supabase
        .from("event_staff")
        .select("employee:employees(id, email, phone, permission_tier)")
        .eq("event_id", ctx.eventId);
      for (const s of (staff ?? []) as unknown as { employee: EmployeeLite | null }[]) {
        if (s.employee) mergeRecipient(perEmployee, s.employee, asRow);
      }
    }
  }

  // Explicit recipients (e.g. the just-assigned staffer) inherit the strongest
  // channel set present on any enabled audience for this type.
  if (ctx.employeeIds?.length) {
    const union = rows.reduce<Channels>(
      (acc, r) => ({ in_app: acc.in_app || r.in_app, push: acc.push || r.push, email: acc.email || r.email, sms: acc.sms || r.sms }),
      { in_app: false, push: false, email: false, sms: false }
    );
    for (const id of ctx.employeeIds) {
      const emp = await fetchEmployee(supabase, id);
      if (emp) mergeRecipient(perEmployee, emp, union);
    }
  }

  if (perEmployee.size === 0) return;

  // Render staff copy once (merge tags need an event). Falls back to raw text.
  const title = await render(supabase, ctx.eventId, t.staff_title_tpl) ?? typeKey;
  const body = await render(supabase, ctx.eventId, t.staff_body_tpl);
  const href = t.href_tpl ? substituteHref(t.href_tpl, ctx.eventId) : null;

  const recipients = [...perEmployee.values()];

  // ---- In-app bell (targeted per employee) ----
  // payment_received still has a live legacy DB trigger (notify_payment →
  // 'new_payment_received') that writes a broadcast bell on every payment path,
  // so skip in-app here for it to avoid a duplicate. Everything else (including
  // agreement_signed — its legacy office bell is suppressed by the notif_types
  // allowlist) is owned by the dispatcher. Inserts go through the SECURITY
  // DEFINER create_targeted_notification so they succeed from any RLS context.
  const LEGACY_INAPP = new Set(["payment_received"]);
  if (!LEGACY_INAPP.has(typeKey)) {
    for (const r of recipients.filter((r) => r.ch.in_app)) {
      await supabase.rpc("create_targeted_notification", {
        p_type: typeKey,
        p_title: title,
        p_body: body ?? null,
        p_href: href,
        p_target_employee: r.emp.id,
        p_target_roles: [],
      });
    }
  }

  // ---- Push (Expo) ----
  const pushEmpIds = recipients.filter((r) => r.ch.push).map((r) => r.emp.id);
  if (pushEmpIds.length) {
    await sendPushToEmployees(supabase, pushEmpIds, { title, body: body ?? undefined, href });
  }

  // ---- Email (staff alert) ----
  const emailTargets = recipients.filter((r) => r.ch.email && r.emp.email);
  if (emailTargets.length) {
    const sender = ctx.eventId ? await resolveSender(supabase, ctx.eventId) : null;
    const emailRows = emailTargets.map((r) => ({
      event_id: ctx.eventId ?? null,
      client_id: null,
      to_address: r.emp.email,
      from_name: sender?.name ?? "Xpress Entertainment",
      from_address: sender?.email ?? null,
      reply_to: sender?.reply_to ?? null,
      subject: title,
      body_html: `<p>${escapeHtml(body ?? title)}</p>`,
      status: "queued",
    }));
    await supabase.from("email_log").insert(emailRows);
  }

  // ---- SMS (staff alert) ----
  const smsTargets = recipients.filter((r) => r.ch.sms && r.emp.phone);
  if (smsTargets.length) {
    const smsBody = [title, body].filter(Boolean).join(" — ");
    const smsRows = smsTargets.map((r) => ({
      event_id: ctx.eventId ?? null,
      client_id: null,
      to_number: r.emp.phone,
      body: smsBody,
      status: "queued",
    }));
    await supabase.from("sms_log").insert(smsRows);
  }
}

function mergeRecipient(
  map: Map<string, { emp: EmployeeLite; ch: Channels }>,
  emp: EmployeeLite,
  r: { in_app: boolean; push: boolean; email: boolean; sms: boolean }
) {
  const existing = map.get(emp.id);
  if (existing) {
    existing.ch = {
      in_app: existing.ch.in_app || r.in_app,
      push: existing.ch.push || r.push,
      email: existing.ch.email || r.email,
      sms: existing.ch.sms || r.sms,
    };
  } else {
    map.set(emp.id, { emp, ch: { in_app: r.in_app, push: r.push, email: r.email, sms: r.sms } });
  }
}

async function fetchEmployee(supabase: SupabaseClient, id: string): Promise<EmployeeLite | null> {
  const { data } = await supabase
    .from("employees")
    .select("id, email, phone, permission_tier")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  return (data as EmployeeLite | null) ?? null;
}

async function render(supabase: SupabaseClient, eventId: string | null | undefined, tpl: string | null): Promise<string | null> {
  if (!tpl) return null;
  if (!eventId) return tpl;
  const { data, error } = await supabase.rpc("render_merge_tags", { p_event_id: eventId, p_template: tpl });
  if (error || typeof data !== "string") return tpl;
  return data;
}

function substituteHref(tpl: string, eventId: string | null | undefined): string {
  return eventId ? tpl.replace("<event_id>", eventId) : tpl.replace("/events/<event_id>", "/events");
}

type Sender = { name: string | null; email: string | null; reply_to: string | null };
async function resolveSender(supabase: SupabaseClient, eventId: string): Promise<Sender | null> {
  const { data } = await supabase.rpc("resolve_sender", { p_event_id: eventId, p_from: "company" });
  const s = data as { name?: string; email?: string; reply_to?: string } | null;
  return s ? { name: s.name ?? null, email: s.email ?? null, reply_to: s.reply_to ?? null } : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Look up active Expo push tokens for the given employees and send. */
async function sendPushToEmployees(
  supabase: SupabaseClient,
  employeeIds: string[],
  msg: { title: string; body?: string; href?: string | null }
): Promise<void> {
  const { data: tokens } = await supabase
    .from("device_tokens")
    .select("expo_push_token")
    .in("employee_id", employeeIds)
    .eq("is_active", true);
  const list = (tokens ?? []).map((t) => (t as { expo_push_token: string }).expo_push_token).filter(Boolean);
  if (list.length === 0) return;
  await sendExpoPush(
    list.map((to) => ({
      to,
      title: msg.title,
      body: msg.body ?? "",
      sound: "default",
      data: msg.href ? { href: msg.href } : {},
    }))
  );
}

type ExpoMessage = { to: string; title: string; body: string; sound?: string; data?: Record<string, unknown> };

/** POST messages to Expo's push service (batched by 100). Best-effort. */
export async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      console.error("[notify] expo push failed", err);
    }
  }
}
