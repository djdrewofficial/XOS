import type { SupabaseClient } from "@supabase/supabase-js";
import { helperAllowedForEventType, helperAllowedForFieldStaff, helperAllowedForRole } from "@/lib/helperAccess";
import {
  actionNeedsRecipientMigration,
  contactLabel,
  parseRecipientConfig,
  resolveHelperRecipients,
  selectContactsForConfig,
  summarizeRecipientConfig,
  type HelperRecipientConfig,
} from "@/lib/helperRecipients";
import { loadEventContacts } from "@/lib/loadEventContacts";

export type HelperSmsPrompt = {
  index: number;
  kind: "client" | "custom" | "staff";
  label: string;
  template: string | null;
  recipients: { name: string | null; phone: string }[];
  body: string;
};

export type HelperSmsOverride = { skip?: boolean; body?: string };

/** Per-action recipient decision from the confirm dialog checkboxes. */
export type HelperRecipientOverride = {
  skip?: boolean;
  client_ids?: string[];
};

export type HelperStepRecipientPreview = {
  index: number;
  channel: "email" | "sms";
  label: string;
  templateName: string | null;
  configSummary: string;
  /** Contacts the template mode selected (before staff unchecks). */
  candidates: {
    clientId: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    isPrimary: boolean;
    isContractHolder: boolean;
    /** Has the channel address needed for this step. */
    canSend: boolean;
    warning: string | null;
  }[];
  warnings: string[];
};

const SMS_BODY_MAX = 1600;

export function cleanSmsOverrides(overrides?: Record<string, HelperSmsOverride> | null): Record<string, HelperSmsOverride> | null {
  if (!overrides) return null;
  const out: Record<string, HelperSmsOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^\d+$/.test(key) || !value) continue;
    if (value.skip) {
      out[key] = { skip: true };
      continue;
    }
    const body = (value.body ?? "").trim().slice(0, SMS_BODY_MAX);
    if (body) out[key] = { body };
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function cleanRecipientOverrides(
  overrides?: Record<string, HelperRecipientOverride> | null,
): Record<string, HelperRecipientOverride> | null {
  if (!overrides) return null;
  const out: Record<string, HelperRecipientOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^\d+$/.test(key) || !value) continue;
    if (value.skip) {
      out[key] = { skip: true };
      continue;
    }
    if (Array.isArray(value.client_ids)) {
      const ids = [...new Set(value.client_ids.map(String).filter(Boolean))];
      out[key] = { client_ids: ids };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function missingRpc(message: string): boolean {
  return /could not find|schema cache|PGRST202|function .* does not exist|no function matches/i.test(message);
}

/** What a helper would text, without sending. Same RPC the event page uses. */
export async function previewHelperSms(admin: SupabaseClient, eventId: string, helperId: string): Promise<HelperSmsPrompt[]> {
  const { data, error } = await admin.rpc("preview_helper_sms", {
    p_helper_id: helperId,
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as HelperSmsPrompt[];
}

type HelperActionRow = {
  type?: string;
  to?: string;
  from?: string;
  template_id?: string;
  recipients?: unknown;
  prompt?: boolean;
};

/** Resolved recipient lists for every client email/SMS step on a helper. */
export async function previewHelperRecipients(
  admin: SupabaseClient,
  eventId: string,
  helperId: string,
): Promise<HelperStepRecipientPreview[]> {
  const [{ data: helper }, contacts] = await Promise.all([
    admin.from("booking_helpers").select("actions").eq("id", helperId).maybeSingle(),
    loadEventContacts(admin, eventId),
  ]);
  if (!helper) throw new Error("Helper not found.");

  const actions = (helper.actions ?? []) as HelperActionRow[];
  const templateIds = [
    ...new Set(
      actions
        .filter((a) => (a.type === "send_email" || a.type === "send_sms") && a.to !== "custom" && a.template_id)
        .map((a) => a.template_id as string),
    ),
  ];
  const nameById = new Map<string, string>();
  if (templateIds.length > 0) {
    const { data: tpls } = await admin.from("email_templates").select("id, name").in("id", templateIds);
    for (const t of tpls ?? []) nameById.set(t.id as string, t.name as string);
  }

  const out: HelperStepRecipientPreview[] = [];
  actions.forEach((act, index) => {
    if ((act.type !== "send_email" && act.type !== "send_sms") || act.to === "custom") return;
    const channel = act.type === "send_email" ? "email" : "sms";
    const cfg = parseRecipientConfig(act.recipients);
    const matched = selectContactsForConfig(contacts, cfg);
    const resolved = resolveHelperRecipients({ contacts, config: cfg, channel });
    const candidates = matched.map((r) => {
      const canSend = channel === "email" ? Boolean((r.email ?? "").trim()) : Boolean((r.phone ?? "").trim());
      return {
        clientId: r.clientId,
        name: contactLabel(r),
        email: r.email,
        phone: r.phone,
        role: r.role,
        isPrimary: r.isPrimary,
        isContractHolder: r.isContractHolder,
        canSend,
        warning: canSend
          ? null
          : channel === "email"
            ? "No email on file — will be skipped."
            : "No phone on file — will be skipped.",
      };
    });

    out.push({
      index,
      channel,
      label: channel === "email" ? "Email to event contacts" : "Text to event contacts",
      templateName: act.template_id ? nameById.get(act.template_id) ?? null : null,
      configSummary: summarizeRecipientConfig(cfg),
      candidates,
      warnings: resolved.warnings,
    });
  });

  return out;
}

/** Stamp Comms/GHL source metadata on email_log rows a helper just queued.
    Safe before migration 00236 (unknown-column errors are ignored). */
export async function stampHelperQueuedEmails(
  admin: SupabaseClient,
  opts: { eventId: string; helperId: string; helperTitle: string; sinceIso: string },
): Promise<void> {
  const sourceLabel = `Booking helper: ${opts.helperTitle}`;
  const stamp = await admin
    .from("email_log")
    .update({
      helper_id: opts.helperId,
      comms_source: "booking_helper",
      comms_source_label: sourceLabel,
      ghl_sync_status: "pending",
    })
    .eq("event_id", opts.eventId)
    .eq("status", "queued")
    .gte("created_at", opts.sinceIso);
  if (stamp.error && !/column|schema cache/i.test(stamp.error.message)) {
    console.warn("helper email_log source stamp failed:", stamp.error.message);
  }
}

function helperActionsNeedRecipientRpc(actions: HelperActionRow[]): boolean {
  return actions.some((a) => actionNeedsRecipientMigration(a));
}

function recipientOverridesNeedRpc(overrides: Record<string, HelperRecipientOverride> | null): boolean {
  if (!overrides) return false;
  return Object.keys(overrides).length > 0;
}

/**
 * After a legacy (pre-00238) helper run queued only the primary client, cancel
 * those client email/SMS rows and re-queue for the resolved recipient set.
 * Used only when migration 00238 is not applied yet and staff picked recipients.
 */
async function rewriteLegacyClientRecipients(
  admin: SupabaseClient,
  opts: {
    eventId: string;
    helperId: string;
    sinceIso: string;
    actions: HelperActionRow[];
    recipientOverrides: Record<string, HelperRecipientOverride> | null;
    manual: boolean;
  },
): Promise<string[]> {
  const contacts = await loadEventContacts(admin, opts.eventId);
  const warnings: string[] = [];
  const emailTemplateIds: string[] = [];

  function shouldRewrite(index: number, act: HelperActionRow): boolean {
    const ovr = opts.recipientOverrides?.[String(index)];
    if (ovr) return true;
    return actionNeedsRecipientMigration(act);
  }

  for (let index = 0; index < opts.actions.length; index++) {
    const act = opts.actions[index];
    if ((act.type !== "send_email" && act.type !== "send_sms") || act.to === "custom") continue;
    if (!shouldRewrite(index, act)) continue;
    const ovr = opts.recipientOverrides?.[String(index)];
    const cfg = parseRecipientConfig(act.recipients);
    const channel = act.type === "send_email" ? "email" : "sms";
    if (ovr?.skip) {
      warnings.push(`${channel === "email" ? "Email" : "SMS"} step skipped by staff.`);
      continue;
    }
    const resolved = resolveHelperRecipients({
      contacts,
      config: cfg,
      overrideClientIds: ovr && "client_ids" in ovr ? ovr.client_ids ?? [] : null,
      channel,
    });
    warnings.push(...resolved.warnings);

    if (act.type === "send_email" && act.template_id) {
      emailTemplateIds.push(act.template_id);
    }
  }

  // Cancel primary-targeted client emails queued by the legacy engine for these templates.
  if (emailTemplateIds.length > 0) {
    const uniq = [...new Set(emailTemplateIds)];
    const { error } = await admin
      .from("email_log")
      .update({ status: "cancelled" })
      .eq("event_id", opts.eventId)
      .eq("status", "queued")
      .gte("created_at", opts.sinceIso)
      .in("template_id", uniq);
    if (error) throw new Error(error.message);
  }

  // Cancel primary-targeted client SMS queued since this run (staff SMS has null client_id).
  {
    const { data: ev } = await admin.from("events").select("client_id").eq("id", opts.eventId).maybeSingle();
    if (ev?.client_id) {
      const { error } = await admin
        .from("sms_log")
        .update({ status: "cancelled" })
        .eq("event_id", opts.eventId)
        .eq("client_id", ev.client_id)
        .eq("status", "queued")
        .gte("created_at", opts.sinceIso);
      if (error) throw new Error(error.message);
    }
  }

  // Re-queue correct recipients using the same merge-tag path as the helper engine.
  for (let index = 0; index < opts.actions.length; index++) {
    const act = opts.actions[index];
    if ((act.type !== "send_email" && act.type !== "send_sms") || act.to === "custom") continue;
    if (!shouldRewrite(index, act)) continue;
    const ovr = opts.recipientOverrides?.[String(index)];
    const cfg = parseRecipientConfig(act.recipients);
    if (ovr?.skip) continue;

    const channel = act.type === "send_email" ? "email" : "sms";
    const resolved = resolveHelperRecipients({
      contacts,
      config: cfg,
      overrideClientIds: ovr && "client_ids" in ovr ? ovr.client_ids ?? [] : null,
      channel,
    });

    if (act.type === "send_email") {
      if (!act.template_id) continue;
      const { data: t } = await admin
        .from("email_templates")
        .select("id, subject, body_html, is_active")
        .eq("id", act.template_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!t) throw new Error("send_email: template not found");
      const { data: sender } = await admin.rpc("resolve_sender", {
        p_event_id: opts.eventId,
        p_from: act.from ?? "company",
      });
      const subject = await renderMerge(admin, opts.eventId, t.subject ?? "");
      const body = await renderMerge(admin, opts.eventId, t.body_html ?? "");
      for (const r of resolved.selected) {
        const { error } = await admin.from("email_log").insert({
          event_id: opts.eventId,
          client_id: r.clientId,
          template_id: t.id,
          to_address: r.email,
          from_name: (sender as { name?: string } | null)?.name ?? null,
          from_address: (sender as { email?: string } | null)?.email ?? null,
          reply_to: (sender as { reply_to?: string } | null)?.reply_to ?? null,
          subject,
          body_html: body,
          status: "queued",
          bypass_comms_pause: opts.manual,
        });
        if (error) throw new Error(error.message);
      }
    } else {
      let body = "";
      let isMarketing = false;
      if (act.template_id) {
        const { data: t } = await admin
          .from("email_templates")
          .select("id, body_html, is_active, is_sms, sms_marketing")
          .eq("id", act.template_id)
          .eq("is_active", true)
          .eq("is_sms", true)
          .maybeSingle();
        if (!t) throw new Error("send_sms: SMS template not found");
        const rendered = await renderMerge(admin, opts.eventId, t.body_html ?? "");
        const { data: plain } = await admin.rpc("xos_html_to_sms", { p_html: rendered });
        body = (plain as string) ?? rendered;
        isMarketing = Boolean(t.sms_marketing);
      }
      for (const r of resolved.selected) {
        const { error } = await admin.from("sms_log").insert({
          event_id: opts.eventId,
          client_id: r.clientId,
          to_number: r.phone,
          body,
          status: "queued",
          is_marketing: isMarketing,
          bypass_comms_pause: opts.manual,
        });
        if (error) throw new Error(error.message);
      }
    }
  }

  return warnings;
}

async function renderMerge(admin: SupabaseClient, eventId: string, template: string): Promise<string> {
  const { data, error } = await admin.rpc("render_merge_tags", { p_event_id: eventId, p_template: template });
  if (error) throw new Error(error.message);
  return (data as string) ?? template;
}

/** The event-page helper button. The database queues the helper's actions
    (including contract emails, with database merge tags filled). This function
    then runs the app outbox so quote, payment-plan, and sign-link tags are
    filled in TypeScript and the message actually goes out. Calling only the
    database function leaves those tags blank. */
export async function executeBookingHelper(
  admin: SupabaseClient,
  input: {
    eventId: string;
    helperId: string;
    smsOverrides?: Record<string, HelperSmsOverride> | null;
    recipientOverrides?: Record<string, HelperRecipientOverride> | null;
    actorRole: string | null;
    /** Field staff (employee / marketing tier). Enforced even when enforceRole is false. */
    actorFieldStaff?: boolean;
    /** Staff clicks pass true. A service token is not a staff role; the token
        scopes are the authorization, and the event-type limit still applies. */
    enforceRole: boolean;
  },
): Promise<{ title: string; warnings: string[] }> {
  const [{ data: scope }, { data: ev }] = await Promise.all([
    admin
      .from("booking_helpers")
      .select("title, visible_event_type_ids, allowed_roles, actions")
      .eq("id", input.helperId)
      .maybeSingle(),
    admin.from("events").select("event_type_id").eq("id", input.eventId).maybeSingle(),
  ]);
  if (!scope) throw new Error("Helper not found.");
  if (!ev) throw new Error("Event not found.");
  if (!helperAllowedForEventType(scope, ev.event_type_id as string | null)) {
    throw new Error(`"${scope.title}" isn't set up for this event type.`);
  }
  if (input.enforceRole && !helperAllowedForRole(scope, input.actorRole)) {
    throw new Error(`Your role can't run "${scope.title}".`);
  }
  if (input.actorFieldStaff && !helperAllowedForFieldStaff(scope, input.actorRole)) {
    throw new Error(`Your role can't run "${scope.title}".`);
  }

  const actions = (scope.actions ?? []) as HelperActionRow[];
  const smsOverrides = cleanSmsOverrides(input.smsOverrides);
  const recipientOverrides = cleanRecipientOverrides(input.recipientOverrides);
  const needsRecipientRpc =
    helperActionsNeedRecipientRpc(actions) || recipientOverridesNeedRpc(recipientOverrides);

  const queuedSince = new Date().toISOString();
  let warnings: string[] = [];

  if (needsRecipientRpc) {
    const { error } = await admin.rpc("run_booking_helper", {
      p_helper_id: input.helperId,
      p_event_id: input.eventId,
      p_sms_overrides: smsOverrides,
      p_recipient_overrides: recipientOverrides ?? {},
    });
    if (error && missingRpc(error.message)) {
      // Migration 00238 not applied yet: run legacy engine then rewrite client sends.
      const legacy = await admin.rpc("run_booking_helper", {
        p_helper_id: input.helperId,
        p_event_id: input.eventId,
        p_sms_overrides: smsOverrides,
      });
      if (legacy.error) throw new Error(legacy.error.message);
      warnings = await rewriteLegacyClientRecipients(admin, {
        eventId: input.eventId,
        helperId: input.helperId,
        sinceIso: queuedSince,
        actions,
        recipientOverrides,
        manual: true,
      });
    } else if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await admin.rpc("run_booking_helper", {
      p_helper_id: input.helperId,
      p_event_id: input.eventId,
      p_sms_overrides: smsOverrides,
    });
    if (error) throw new Error(error.message);
  }

  await stampHelperQueuedEmails(admin, {
    eventId: input.eventId,
    helperId: input.helperId,
    helperTitle: scope.title as string,
    sinceIso: queuedSince,
  });
  // Loaded here so the role and event-type guards above can run without the mail stack.
  const [{ fireHelperWebhook }, { drainEventOutbox }] = await Promise.all([import("@/lib/automations"), import("@/lib/scopedOutbox")]);
  await fireHelperWebhook(admin, input.helperId, input.eventId);
  await drainEventOutbox(admin, input.eventId, queuedSince);
  return { title: scope.title as string, warnings };
}

export type { HelperRecipientConfig };
