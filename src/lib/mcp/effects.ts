import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpScopeError } from "./types";

export type HelperEffect = {
  helper_id: string;
  helper_title: string | null;
  helper_updated_at: string | null;
  action: string;
  template_id?: string | null;
  template_name?: string | null;
  template_updated_at?: string | null;
  template_body_sha256?: string | null;
  attaches_document?: boolean;
  webhook_host?: string | null;
  rendered_title?: string | null;
  rendered_body?: string | null;
  recipient?: string | null;
};

export type EffectReport = {
  effects: HelperEffect[];
  scopes: string[];
  cycle: boolean;
};

type HelperRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
  webhook_url: string | null;
  actions: unknown;
};

type TemplateRow = {
  id: string;
  name: string | null;
  updated_at: string | null;
  body_html: string | null;
  attach_template_id: string | null;
  is_sms: boolean | null;
  sms_marketing: boolean | null;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "invalid-webhook-url";
  }
}

/** Walk helper actions, including nested run_helper, without following a cycle. */
export async function collectHelperEffects(
  admin: SupabaseClient,
  helperId: string,
  seen = new Set<string>(),
): Promise<EffectReport> {
  const effects: HelperEffect[] = [];
  const scopes = new Set<string>();
  let cycle = false;

  async function walk(id: string) {
    if (seen.has(id)) {
      cycle = true;
      effects.push({ helper_id: id, helper_title: null, helper_updated_at: null, action: "cycle" });
      return;
    }
    seen.add(id);
    const { data, error } = await admin
      .from("booking_helpers")
      .select("id, title, updated_at, webhook_url, actions")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Helper not found.");
    const helper = data as HelperRow;
    const webhook = hostOf(helper.webhook_url);
    if (webhook) {
      scopes.add("comms.webhook");
      effects.push({
        helper_id: helper.id,
        helper_title: helper.title,
        helper_updated_at: helper.updated_at,
        action: "webhook",
        webhook_host: webhook,
      });
    }
    const actions = Array.isArray(helper.actions) ? (helper.actions as { type?: string; template_id?: string; helper_id?: string }[]) : [];
    for (const act of actions) {
      const type = act.type ?? "unknown";
      if (type === "run_helper" && act.helper_id) {
        effects.push({
          helper_id: helper.id,
          helper_title: helper.title,
          helper_updated_at: helper.updated_at,
          action: "run_helper",
          template_id: act.helper_id,
        });
        await walk(act.helper_id);
        continue;
      }
      const effect: HelperEffect = {
        helper_id: helper.id,
        helper_title: helper.title,
        helper_updated_at: helper.updated_at,
        action: type,
        template_id: act.template_id ?? null,
      };
      if ((type === "send_email" || type === "send_email_staff" || type === "send_sms" || type === "send_sms_staff") && act.template_id) {
        const { data: tpl, error: tplError } = await admin
          .from("email_templates")
          .select("id, name, updated_at, body_html, attach_template_id, is_sms, sms_marketing")
          .eq("id", act.template_id)
          .maybeSingle();
        if (tplError) throw new Error(tplError.message);
        const template = tpl as TemplateRow | null;
        effect.template_name = template?.name ?? null;
        effect.template_updated_at = template?.updated_at ?? null;
        effect.template_body_sha256 = sha256(template?.body_html ?? "");
        effect.attaches_document = Boolean(template?.attach_template_id);
        if (type.startsWith("send_email")) scopes.add("comms.email");
        if (type.startsWith("send_sms")) scopes.add("comms.sms");
        if (effect.attaches_document) scopes.add("comms.contract");
      } else if (type.startsWith("send_email")) {
        scopes.add("comms.email");
      } else if (type.startsWith("send_sms")) {
        scopes.add("comms.sms");
      }
      effects.push(effect);
    }
  }

  await walk(helperId);
  return { effects, scopes: [...scopes], cycle };
}

export function assertEffectScopes(granted: readonly string[], report: EffectReport) {
  const missing = report.scopes.filter((scope) => !granted.includes(scope));
  if (missing.length) {
    throw new McpScopeError(`This action sends or calls out and needs: ${missing.join(", ")}`);
  }
}

/** Helpers wired to a lifecycle trigger, then their full nested effects. */
export async function collectAutomationEffects(
  admin: SupabaseClient,
  eventId: string,
  trigger: "status_changed" | "payment_received" | "event_created",
  statusId?: string,
): Promise<EffectReport> {
  const { data: ev, error } = await admin.from("events").select("event_type_id, archived_at, planning_template_id").eq("id", eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (ev?.archived_at) return { effects: [], scopes: [], cycle: false };
  const { data: helpers, error: helperError } = await admin
    .from("booking_helpers")
    .select("id, event_type_ids, auto_status_ids, auto_on_payment, auto_on_create, is_active, planning_template_id");
  if (helperError) throw new Error(helperError.message);
  const matched = (helpers ?? []).filter((helper) => {
    if (helper.is_active !== true) return false;
    const types = (helper.event_type_ids as string[] | null) ?? [];
    if (types.length && ev?.event_type_id && !types.includes(ev.event_type_id as string)) return false;
    if (trigger === "payment_received") return helper.auto_on_payment === true;
    if (trigger === "event_created") return helper.auto_on_create === true;
    return !!statusId && ((helper.auto_status_ids as string[] | null) ?? []).includes(statusId);
  });
  const effects: HelperEffect[] = [];
  const scopes = new Set<string>();
  let cycle = false;
  const seen = new Set<string>();
  for (const helper of matched) {
    const templateId = helper.planning_template_id as string | null;
    if (templateId && templateId !== ev?.planning_template_id) {
      effects.push({
        helper_id: helper.id as string,
        helper_title: null,
        helper_updated_at: null,
        action: "planning_template",
        template_id: templateId,
      });
    }
    const report = await collectHelperEffects(admin, helper.id as string, seen);
    effects.push(...report.effects);
    for (const scope of report.scopes) scopes.add(scope);
    cycle = cycle || report.cycle;
  }
  const notice = await collectNotificationEffects(admin, trigger, eventId);
  effects.push(...notice.effects);
  for (const scope of notice.scopes) scopes.add(scope);
  return { effects, scopes: [...scopes], cycle };
}

const NOTIFICATION_KEYS: Record<"status_changed" | "payment_received" | "event_created", string> = {
  status_changed: "event_status_changed",
  payment_received: "payment_received",
  event_created: "event_created",
};

/** Staff notification settings can queue email and SMS beside the helper.
    The preview is the rendered staff title and body, plus who would receive it. */
export async function collectNotificationEffects(
  admin: SupabaseClient,
  trigger: "status_changed" | "payment_received" | "event_created",
  eventId: string,
): Promise<EffectReport> {
  const key = NOTIFICATION_KEYS[trigger];
  const { data: type, error } = await admin
    .from("notification_types")
    .select("key, is_active, staff_title_tpl, staff_body_tpl, email_template_id, sms_template_id")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!type?.is_active) return { effects: [], scopes: [], cycle: false };
  const { data: settings, error: settingError } = await admin
    .from("notification_settings")
    .select("audience, email, sms, is_enabled")
    .eq("type_key", key)
    .eq("is_enabled", true);
  if (settingError) throw new Error(settingError.message);
  const title = await renderNotice(admin, eventId, (type.staff_title_tpl as string | null) ?? key);
  const body = await renderNotice(admin, eventId, (type.staff_body_tpl as string | null) ?? "");
  const recipients = await noticeRecipients(admin, eventId, settings ?? []);
  const effects: HelperEffect[] = [];
  const scopes = new Set<string>();
  if (recipients.length === 0) {
    effects.push({
      helper_id: key,
      helper_title: "notification",
      helper_updated_at: null,
      action: "notify",
      rendered_title: title,
      rendered_body: body,
      recipient: null,
    });
  }
  for (const person of recipients) {
    if (person.email) {
      scopes.add("comms.email");
      effects.push({
        helper_id: key,
        helper_title: "notification",
        helper_updated_at: null,
        action: "notify_email",
        template_id: (type.email_template_id as string | null) ?? null,
        template_name: person.audience,
        rendered_title: title,
        rendered_body: body,
        recipient: person.address,
      });
    }
    if (person.sms) {
      scopes.add("comms.sms");
      effects.push({
        helper_id: key,
        helper_title: "notification",
        helper_updated_at: null,
        action: "notify_sms",
        template_id: (type.sms_template_id as string | null) ?? null,
        template_name: person.audience,
        rendered_title: title,
        rendered_body: body,
        recipient: person.phone,
      });
    }
    if (!person.email && !person.sms) {
      effects.push({
        helper_id: key,
        helper_title: "notification",
        helper_updated_at: null,
        action: "notify",
        template_name: person.audience,
        rendered_title: title,
        rendered_body: body,
        recipient: person.address ?? person.phone,
      });
    }
  }
  return { effects, scopes: [...scopes], cycle: false };
}

async function renderNotice(admin: SupabaseClient, eventId: string, template: string): Promise<string> {
  if (!template) return "";
  const { data, error } = await admin.rpc("render_merge_tags", { p_event_id: eventId, p_template: template });
  if (error || typeof data !== "string") return template;
  return data;
}

async function noticeRecipients(
  admin: SupabaseClient,
  eventId: string,
  settings: { audience: string; email: boolean; sms: boolean }[],
): Promise<{ audience: string; email: boolean; sms: boolean; address: string | null; phone: string | null }[]> {
  const out: { audience: string; email: boolean; sms: boolean; address: string | null; phone: string | null }[] = [];
  const roles = settings.filter((row) => ["master_admin", "admin", "salesperson", "employee", "marketing"].includes(row.audience));
  if (roles.length) {
    const { data } = await admin.from("employees").select("email, phone, permission_tier").in("permission_tier", roles.map((row) => row.audience)).eq("is_active", true);
    for (const emp of data ?? []) {
      const row = roles.find((item) => item.audience === emp.permission_tier);
      if (!row) continue;
      out.push({ audience: row.audience, email: row.email, sms: row.sms, address: emp.email ?? null, phone: emp.phone ?? null });
    }
  }
  const salesperson = settings.find((row) => row.audience === "event_salesperson");
  const assigned = settings.find((row) => row.audience === "event_assigned_staff");
  if (salesperson || assigned) {
    const { data: event } = await admin.from("events").select("salesperson_id").eq("id", eventId).maybeSingle();
    if (salesperson && event?.salesperson_id) {
      const { data: emp } = await admin.from("employees").select("email, phone").eq("id", event.salesperson_id).maybeSingle();
      if (emp) out.push({ audience: "event_salesperson", email: salesperson.email, sms: salesperson.sms, address: emp.email ?? null, phone: emp.phone ?? null });
    }
    if (assigned) {
      const { data: staff } = await admin.from("event_staff").select("employee:employees(email, phone)").eq("event_id", eventId);
      for (const row of staff ?? []) {
        const emp = row.employee as { email?: string | null; phone?: string | null } | { email?: string | null; phone?: string | null }[] | null;
        const person = Array.isArray(emp) ? emp[0] : emp;
        if (!person) continue;
        out.push({ audience: "event_assigned_staff", email: assigned.email, sms: assigned.sms, address: person.email ?? null, phone: person.phone ?? null });
      }
    }
  }
  return out;
}
