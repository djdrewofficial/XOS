import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteClientToXos, sendAccountInvite, sendPasswordReset } from "@/lib/accounts";
import { previewHelperSms } from "@/lib/bookingHelperRun";
import { inviteEffect } from "@/lib/officeEdits";
import { RESET_APPROVAL_BODY } from "@/lib/oneTimeLink";
import { findOrCreateClient } from "@/lib/clients";
import { generateDocumentRow, loadEventBundle } from "@/lib/documentRender";
import { anonymizeClientRecord } from "@/lib/anonymizeClient";
import { updateEventFinancialsRecord } from "@/lib/eventFinancials";
import { archiveEventRecord, assertEventDeletable, unarchiveEventRecord } from "@/lib/eventLifecycle";
import { syncStaffToHighLevel, processSmsOutbox } from "@/lib/highlevel";
import { processOutbox } from "@/lib/mailgun";
import { applyPackageSelection, assignAddonEquipment } from "@/lib/packageSelection";
import { parseSchedulePlan, recordPayment, confirmPaymentRecord, restorePaymentRecord, saveRemainingScheduleRows, softRemovePayment, updatePaymentRecord, addScheduledPaymentPlan } from "@/lib/paymentOps";
import { loadEventPlanning } from "@/lib/planning";
import { assignAddonSections } from "@/lib/planning";
import { reseedEventPlanning } from "@/lib/planning";
import { runAutomations } from "@/lib/automations";
import { freezeTemplateEmail, previewSms, previewTemplateEmail, sendSms, sendTemplateEmail } from "@/lib/queueTemplateSend";
import { SCHEDULE_TEMPLATE_COLUMNS, mapTemplate, targetDateFor, templateMatchesEvent, zonedParts, type ScheduleEventFacts, type TemplateRow } from "@/lib/scheduledComms";
import { previewDocumentSend, sendDocumentForSignature } from "@/lib/sendForSignature";
import { isPhoneOptedOut } from "@/lib/smsOptOut";
import { assertSmsBody } from "../smsPolicy";
import { buildOutstanding } from "@/lib/reports/build";
import { staffCost, staffHours } from "@/lib/payroll";
import { canonicalJson, sha256 } from "../crypto";
import { assertEffectScopes, collectAutomationEffects, collectHelperEffects } from "../effects";
import { McpScopeError, type ToolContext } from "../types";
import type { LiveTool } from "../protocol";
import type { JsonSchema } from "../validate";

const UUID: JsonSchema = { type: "string", format: "uuid" };

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}

async function queuedOutboxSnapshot(admin: SupabaseClient) {
  const [email, sms] = await Promise.all([
    query(admin.from("email_log").select("id, event_id, to_address, subject, body_html").eq("status", "queued")),
    query(admin.from("sms_log").select("id, event_id, to_number, body").eq("status", "queued")),
  ]);
  const emailRows = (email ?? []) as { id: string; event_id: string | null; to_address: string | null; subject: string | null; body_html: string | null }[];
  const smsRows = (sms ?? []) as { id: string; event_id: string | null; to_number: string | null; body: string | null }[];
  const total = emailRows.length + smsRows.length;
  if (total > 100) {
    throw new Error(`Refused: ${total} messages are queued. This tool will not send a queue it cannot list in full.`);
  }
  return {
    complete: true,
    total,
    email: emailRows.map((row) => ({ id: row.id, event_id: row.event_id, to: row.to_address, subject: row.subject, body: row.body_html })),
    sms: smsRows.map((row) => ({ id: row.id, event_id: row.event_id, to: row.to_number, body: row.body })),
  };
}

async function inboxReplySnapshot(admin: SupabaseClient, args: Record<string, unknown>) {
  const channel = s(args, "channel") ?? "SMS";
  const body = channel === "SMS" ? assertSmsBody(s(args, "body") ?? "") : (s(args, "body") ?? "");
  const { data } = await admin.from("hl_conversations").select("contact_name, phone, email").eq("id", s(args, "conversation_id")).maybeSingle();
  return {
    to_name: data?.contact_name ?? null,
    to: channel === "Email" ? data?.email ?? null : data?.phone ?? null,
    channel,
    body,
    classification: channel === "SMS" ? "freeform_is_marketing" : channel,
    complete: true,
  };
}

async function dueScheduledMessages(admin: SupabaseClient, eventId: string) {
  const [{ data: event, error: eventError }, { data: templates, error: templateError }, { data: settings }, { data: addons }, { data: staff }, { data: payments }] = await Promise.all([
    admin.from("events").select("name, event_date, booked_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date, status_id, event_type_id, package_id, salesperson_id").eq("id", eventId).maybeSingle(),
    admin.from("email_templates").select(`${SCHEDULE_TEMPLATE_COLUMNS}, schedule_enabled`).eq("is_active", true).eq("schedule_enabled", true),
    admin.from("company_settings").select("timezone").eq("id", true).maybeSingle(),
    admin.from("event_addons").select("addon_id").eq("event_id", eventId),
    admin.from("event_staff").select("employee_id").eq("event_id", eventId),
    admin.from("payments").select("amount").eq("event_id", eventId).is("deleted_at", null),
  ]);
  if (eventError) throw new Error(eventError.message);
  if (templateError) throw new Error(templateError.message);
  if (!event) throw new Error("Event not found.");
  const bundle = await loadEventBundle(admin, eventId);
  const today = zonedParts(new Date(), settings?.timezone || "America/New_York").date;
  const facts: ScheduleEventFacts = {
    eventDate: event.event_date,
    bookedDate: event.booked_date,
    initialContactDate: event.initial_contact_date,
    contractSentDate: event.contract_sent_date,
    contractDueDate: event.contract_due_date,
    contractSignedDate: event.contract_signed_date,
    quoteSentDate: event.quote_sent_date,
    statusId: event.status_id,
    eventTypeId: event.event_type_id,
    packageId: event.package_id,
    salespersonId: event.salesperson_id,
    addonIds: (addons ?? []).map((row) => row.addon_id as string),
    staffEmployeeIds: (staff ?? []).map((row) => row.employee_id as string),
    schedulerTotal: bundle?.total ?? 0,
    paymentsSum: (payments ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  };
  const messages = [];
  for (const raw of templates ?? []) {
    const template = mapTemplate(raw as TemplateRow);
    if (!template || !templateMatchesEvent(template, facts)) continue;
    const target = targetDateFor(template, facts);
    if (target !== today) continue;
    if (template.isSms) {
      const sms = await previewSms(admin, { eventId, templateId: template.id, to: "primary_client" });
      messages.push({ template_id: template.id, is_sms: true, to: sms.to, subject: null, body: sms.body, target_date: target });
    } else {
      const email = await previewTemplateEmail(admin, { eventId, templateId: template.id, to: "primary_client" });
      messages.push({ template_id: template.id, is_sms: false, to: email.to, subject: email.subject, body: email.body, target_date: target });
    }
  }
  return messages;
}

async function clientInviteSnapshot(admin: SupabaseClient, clientId: string) {
  const { data } = await admin.from("clients").select("email").eq("id", clientId).maybeSingle();
  const { data: settings } = await admin.from("company_settings").select("invite_template_id").eq("id", true).maybeSingle();
  const templateId = (settings?.invite_template_id as string | null) ?? null;
  const { data: template } = templateId
    ? await admin.from("email_templates").select("subject, body_html").eq("id", templateId).maybeSingle()
    : { data: null };
  return inviteEffect({ email: data?.email, templateSubject: template?.subject, templateBody: template?.body_html });
}

async function clientResetSnapshot(admin: SupabaseClient, clientId: string) {
  const { data } = await admin.from("clients").select("email").eq("id", clientId).maybeSingle();
  return inviteEffect({ email: data?.email, templateSubject: "Reset your XOS password", templateBody: RESET_APPROVAL_BODY });
}

function adminOf(ctx: ToolContext): SupabaseClient {
  if (!ctx.admin || typeof ctx.admin.from !== "function") throw new Error("Database client is not available.");
  return ctx.admin;
}

function pageMeta(rows: unknown, limit: number) {
  const items = Array.isArray(rows) ? rows : [];
  return { items, limit, returned: items.length, may_have_more: items.length >= limit };
}

async function query(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return stripSecrets(data);
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "access_token" || key === "pay_token" || key === "token_hash" || key === "token") continue;
      out[key] = stripSecrets(child);
    }
    return out;
  }
  return value;
}

function s(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function n(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function actor(ctx: ToolContext) {
  return `mcp:${ctx.token.name}`.slice(0, 80);
}

async function requireHelperScopes(ctx: ToolContext, helperId: string) {
  const report = await collectHelperEffects(adminOf(ctx), helperId);
  assertEffectScopes(ctx.token.scopes, report);
  return report;
}

const limitProp: JsonSchema = { type: "integer", minimum: 1, maximum: 100 };

export const officeTools: LiveTool[] = [
  {
    name: "search",
    description: "Search events, clients, venues, vendors, staff, and packages by name, email, phone, or event number. Returns only categories this token can read.",
    scopes: [],
    confirm: false,
    inputSchema: obj({ q: { type: "string", minLength: 2, maxLength: 80 } }, ["q"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const q = s(args, "q") ?? "";
      const esc = q.replace(/[%,()]/g, "").trim();
      const like = `%${esc}%`;
      const num = q.replace(/^#/, "").trim();
      const eventOr = /^\d{1,12}$/.test(num) ? `event_number.eq.${num},legacy_djep_id.eq.${num},name.ilike.${like}` : `name.ilike.${like}`;
      const can = (scope: string) => ctx.token.scopes.includes(scope);
      const [events, clients, venues, vendors, staff, packages] = await Promise.all([
        can("read.events") ? query(admin.from("events").select("id, name, event_date, event_number").is("archived_at", null).or(eventOr).limit(8)) : [],
        can("read.clients") ? query(admin.from("clients").select("id, first_name, last_name, email").or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(8)) : [],
        can("read.venues") ? query(admin.from("venues").select("id, name, city").ilike("name", like).limit(6)) : [],
        can("read.vendors") ? query(admin.from("vendors").select("id, company_name").ilike("company_name", like).limit(6)) : [],
        can("read.staff") ? query(admin.from("employees").select("id, first_name, last_name").or(`first_name.ilike.${like},last_name.ilike.${like}`).limit(6)) : [],
        can("read.catalog") ? query(admin.from("packages").select("id, name").ilike("name", like).limit(6)) : [],
      ]);
      return { events, clients, venues, vendors, staff, packages };
    },
  },
  {
    name: "events_list",
    description: "List events. Pass archived true to include archived events. Filter by status_id, client_id, or a date (YYYY-MM-DD).",
    scopes: ["read.events"],
    confirm: false,
    inputSchema: obj({
      limit: limitProp,
      archived: { type: "boolean" },
      status_id: UUID,
      client_id: UUID,
      event_date: { type: "string" },
    }),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      let q = admin.from("events").select("id, name, event_date, event_number, status_id, client_id, venue_id, archived_at").order("event_date", { ascending: false }).limit(n(args, "limit") || 50);
      if (args.archived !== true) q = q.is("archived_at", null);
      if (s(args, "status_id")) q = q.eq("status_id", s(args, "status_id"));
      if (s(args, "client_id")) q = q.eq("client_id", s(args, "client_id"));
      if (s(args, "event_date")) q = q.eq("event_date", s(args, "event_date"));
      const limit = n(args, "limit") || 50;
      const page = pageMeta(await query(q), limit);
      return { events: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "events_get",
    description: "Get one event with its client, venue, status, package, add-ons, staff, and payment totals.",
    scopes: ["read.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "event_id");
      const clientCols = ctx.token.scopes.includes("read.clients")
        ? "id, first_name, last_name, email, cell_phone"
        : "id, first_name, last_name";
      const staffCols = ctx.token.scopes.includes("money.payroll")
        ? "id, employee_id, role, flat_wage, confirmed_at, declined_at"
        : "id, employee_id, role, confirmed_at, declined_at";
      const [event, addons, staff, payments, schedule, notes] = await Promise.all([
        query(admin.from("events").select(`id, name, event_number, event_date, setup_time, start_time, end_time, guest_count, status_id, event_type_id, venue_id, package_id, client_id, archived_at, comms_paused, client:clients(${clientCols}), venue:venues(id, name, city), status:event_statuses(id, name)`).eq("id", id).maybeSingle()),
        ctx.token.scopes.includes("read.catalog") ? query(admin.from("event_addons").select("id, addon_id, quantity, price_override, price_locked").eq("event_id", id)) : [],
        ctx.token.scopes.includes("read.staff") ? query(admin.from("event_staff").select(staffCols).eq("event_id", id)) : [],
        ctx.token.scopes.includes("money") ? query(admin.from("payments").select("id, amount, method, reason, status, paid_at, deleted_at").eq("event_id", id)) : [],
        ctx.token.scopes.includes("money") ? query(admin.from("scheduled_payments").select("id, seq, label, amount, due_date").eq("event_id", id).order("seq")) : [],
        query(admin.from("event_notes").select("id, kind, body, created_at").eq("event_id", id).order("created_at", { ascending: false }).limit(30)),
      ]);
      if (!event) throw new Error("Event not found.");
      const notePage = pageMeta(notes, 30);
      return { event, addons, staff, payments, schedule, notes: notePage.items, notes_limit: notePage.limit, notes_returned: notePage.returned, notes_may_have_more: notePage.may_have_more };
    },
  },
  {
    name: "events_form_options",
    description: "Reference lists for creating an event: types, statuses, sources, packages, add-ons, active staff.",
    scopes: ["read.events"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      const admin = adminOf(ctx);
      const [types, statuses, sources, packages, addons, employees] = await Promise.all([
        query(admin.from("event_types").select("id, name").eq("is_active", true).order("name")),
        query(admin.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order")),
        query(admin.from("inquiry_sources").select("id, name").eq("is_active", true).order("name")),
        query(admin.from("packages").select(ctx.token.scopes.includes("read.catalog") ? "id, name, default_price" : "id, name").eq("is_active", true).order("display_order")),
        query(admin.from("addons").select(ctx.token.scopes.includes("read.catalog") ? "id, name, default_price" : "id, name").eq("is_active", true).order("display_order")),
        query(admin.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name")),
      ]);
      return { types, statuses, sources, packages, addons, employees };
    },
  },
  {
    name: "events_create",
    description: "Create an event for an existing client. Applies the package's date price and default add-ons, the same way the simple Add Event form does. Does not run event-created automations; use events_set_status or helpers_run when you mean to message the client.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({
      client_id: UUID,
      name: { type: "string", minLength: 1 },
      event_type_id: UUID,
      status_id: UUID,
      event_date: { type: "string" },
      venue_id: UUID,
      package_id: UUID,
      guest_count: { type: "integer", minimum: 0 },
    }, ["client_id", "name"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const { data, error } = await admin.from("events").insert({
        client_id: s(args, "client_id"),
        name: s(args, "name"),
        event_type_id: s(args, "event_type_id"),
        status_id: s(args, "status_id"),
        event_date: s(args, "event_date"),
        venue_id: s(args, "venue_id"),
        package_id: s(args, "package_id"),
        guest_count: args.guest_count ?? null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      if (s(args, "package_id")) await applyPackageSelection(admin, data.id, s(args, "package_id")!, s(args, "event_date"), false);
      return { id: data.id };
    },
  },
  {
    name: "events_update",
    description: "Update core event fields: name, date, times, guest count, venue, status is separate (events_set_status) because a status change can message the client.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({
      event_id: UUID,
      name: { type: "string" },
      event_date: { type: "string" },
      setup_time: { type: "string" },
      start_time: { type: "string" },
      end_time: { type: "string" },
      guest_count: { type: "integer", minimum: 0 },
      venue_id: UUID,
      internal_notes: { type: "string" },
    }, ["event_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "event_date", "setup_time", "start_time", "end_time", "venue_id", "internal_notes"]) {
        if (key in args) patch[key] = s(args, key);
      }
      if ("guest_count" in args) patch.guest_count = args.guest_count;
      const { error } = await adminOf(ctx).from("events").update(patch).eq("id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_set_status",
    description: "Change an event's status and run the status-changed automations (the real booking-helper path, which may email or text the client).",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, status_id: UUID }, ["event_id", "status_id"]),
    async authorize(args, ctx) {
      const report = await collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "status_changed", s(args, "status_id")!);
      assertEffectScopes(ctx.token.scopes, report);
    },
    async freeze(args, ctx) {
      return collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "status_changed", s(args, "status_id")!);
    },
    async preview(args, ctx) {
      const admin = adminOf(ctx);
      const { data: status } = await admin.from("event_statuses").select("name").eq("id", s(args, "status_id")).maybeSingle();
      const effects = await collectAutomationEffects(admin, s(args, "event_id")!, "status_changed", s(args, "status_id")!);
      return { will_set_status: status?.name ?? s(args, "status_id"), effects };
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "event_id")!;
      const statusId = s(args, "status_id")!;
      const { error } = await admin.from("events").update({ status_id: statusId }).eq("id", id);
      if (error) throw new Error(error.message);
      await runAutomations(admin, id, "status_changed", { statusId, drain: "event" });
      return { ok: true };
    },
  },
  {
    name: "events_set_comms_paused",
    description: "Pause or resume automated client email and SMS for one event. Staff notifications are not paused. A manual helper send still goes out.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, paused: { type: "boolean" } }, ["event_id", "paused"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("events").update({ comms_paused: args.paused === true }).eq("id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true, paused: args.paused === true };
    },
  },
  {
    name: "events_archive",
    description: "Archive an event and cancel its queued client email and SMS. The event and its payments stay.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async preview(args) {
      return { event_id: s(args, "event_id"), effect: "Hides the event and cancels queued client messages." };
    },
    async execute(args, ctx) {
      await archiveEventRecord(adminOf(ctx), s(args, "event_id")!, actor(ctx));
      return { ok: true };
    },
  },
  {
    name: "events_unarchive",
    description: "Restore an archived event to the active list. Does not re-queue messages that were cancelled.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      await unarchiveEventRecord(adminOf(ctx), s(args, "event_id")!, actor(ctx));
      return { ok: true };
    },
  },
  {
    name: "events_delete",
    description: "Permanently delete an event that has no payment history. Events with payments must be archived instead, so money records stay attached.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async preview(args, ctx) {
      await assertEventDeletable(adminOf(ctx), s(args, "event_id")!);
      return { event_id: s(args, "event_id"), effect: "Permanent delete. This event has no payment rows." };
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "event_id")!;
      await assertEventDeletable(admin, id);
      const { error } = await admin.from("events").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_add_note",
    description: "Add an internal note or a contract note on an event. kind is internal or contract.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, body: { type: "string", minLength: 1, maxLength: 8000 }, kind: { type: "string", enum: ["internal", "contract"] } }, ["event_id", "body"]),
    async execute(args, ctx) {
      const { data, error } = await adminOf(ctx).from("event_notes").insert({
        event_id: s(args, "event_id"),
        body: s(args, "body"),
        kind: s(args, "kind") ?? "internal",
      }).select("id").single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    },
  },
  {
    name: "events_delete_note",
    description: "Delete one event note.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, note_id: UUID }, ["event_id", "note_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_notes").delete().eq("id", s(args, "note_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_add_client",
    description: "Attach an existing client to an event. The first client becomes primary.",
    scopes: ["write.events", "write.clients"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, client_id: UUID, role: { type: "string" } }, ["event_id", "client_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const eventId = s(args, "event_id")!;
      const clientId = s(args, "client_id")!;
      const { count } = await admin.from("event_clients").select("id", { count: "exact", head: true }).eq("event_id", eventId);
      const isFirst = (count ?? 0) === 0;
      const { error } = await admin.from("event_clients").insert({ event_id: eventId, client_id: clientId, role: s(args, "role") ?? "Client", is_primary: isFirst });
      if (error) throw new Error(error.message);
      if (isFirst) await admin.from("events").update({ client_id: clientId }).eq("id", eventId);
      return { ok: true, primary: isFirst };
    },
  },
  {
    name: "events_remove_client",
    description: "Remove a client from an event. Refuses when they are the only client. Promotes the next client if the primary is removed.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, event_client_id: UUID }, ["event_id", "event_client_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const eventId = s(args, "event_id")!;
      const eventClientId = s(args, "event_client_id")!;
      const { error } = await admin.rpc("mcp_remove_event_client", {
        p_event_id: eventId,
        p_event_client_id: eventClientId,
      });
      if (error) {
        if (/mcp_remove_event_client|schema cache|could not find/i.test(error.message)) {
          throw new Error("Removing a client is unavailable until migration 00218 is applied. Nothing was deleted.");
        }
        throw new Error(error.message);
      }
      return { ok: true };
    },
  },
  {
    name: "events_add_addon",
    description: "Add a catalog add-on to an event and pull its default equipment and planner sections, the same way the event page does.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, addon_id: UUID, quantity: { type: "integer", minimum: 1 }, price_override: { type: "number", minimum: 0 } }, ["event_id", "addon_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const eventId = s(args, "event_id")!;
      const addonId = s(args, "addon_id")!;
      const { error } = await admin.from("event_addons").insert({
        event_id: eventId,
        addon_id: addonId,
        quantity: Math.max(1, Math.round(n(args, "quantity") || 1)),
        price_override: args.price_override ?? null,
      });
      if (error) throw new Error(error.message);
      await assignAddonEquipment(admin, eventId, addonId);
      await assignAddonSections(eventId, addonId);
      return { ok: true };
    },
  },
  {
    name: "events_remove_addon",
    description: "Remove an add-on line from an event.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, event_addon_id: UUID }, ["event_id", "event_addon_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_addons").delete().eq("id", s(args, "event_addon_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_update_financials",
    description: "Update package, deposit, fees, and discounts. Discounts are clamped so the investment cannot go negative. Changing the package applies its date price and defaults.",
    scopes: ["write.events", "money"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      package_id: UUID,
      package_price_override: { type: "number", minimum: 0 },
      deposit_value: { type: "number", minimum: 0 },
      overtime_fee: { type: "number", minimum: 0 },
      travel_fee: { type: "number", minimum: 0 },
      discount1_amount: { type: "number", minimum: 0 },
      discount2_amount: { type: "number", minimum: 0 },
    }, ["event_id"]),
    async preview(args) {
      return { event_id: s(args, "event_id"), fields: args, note: "Confirm to change the event investment." };
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "event_id")!;
      const { data: current, error } = await admin
        .from("events")
        .select("package_id, package_price_override, deposit_value, overtime_fee, travel_fee, discount1_amount, discount2_amount")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!current) throw new Error("Event not found.");
      const sentOverride = typeof args.package_price_override === "number";
      await updateEventFinancialsRecord(admin, id, {
        packageId: "package_id" in args ? s(args, "package_id") : (current.package_id as string | null),
        packagePriceOverride: sentOverride ? (args.package_price_override as number) : (current.package_price_override as number | null),
        overrideSubmitted: sentOverride || current.package_price_override != null,
        deposit: "deposit_value" in args ? n(args, "deposit_value") : Number(current.deposit_value ?? 0),
        overtime: "overtime_fee" in args ? n(args, "overtime_fee") : Number(current.overtime_fee ?? 0),
        travel: "travel_fee" in args ? n(args, "travel_fee") : Number(current.travel_fee ?? 0),
        discount1: "discount1_amount" in args ? n(args, "discount1_amount") : Number(current.discount1_amount ?? 0),
        discount2: "discount2_amount" in args ? n(args, "discount2_amount") : Number(current.discount2_amount ?? 0),
      });
      return { ok: true };
    },
  },
  {
    name: "events_assign_staff",
    description: "Assign an employee to an event.",
    scopes: ["write.events", "write.staff"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, employee_id: UUID, role: { type: "string" }, flat_wage: { type: "number", minimum: 0 } }, ["event_id", "employee_id"]),
    async execute(args, ctx) {
      if ("flat_wage" in args && !ctx.token.scopes.includes("money.payroll")) {
        throw new McpScopeError("Setting a wage needs money.payroll.");
      }
      const row: Record<string, unknown> = {
        event_id: s(args, "event_id"),
        employee_id: s(args, "employee_id"),
        role: s(args, "role") ?? "DJ",
      };
      if ("flat_wage" in args) row.flat_wage = n(args, "flat_wage");
      const { error } = await adminOf(ctx).from("event_staff").insert(row);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_remove_staff",
    description: "Remove a staff assignment from an event.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, event_staff_id: UUID }, ["event_id", "event_staff_id"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("event_staff").delete().eq("id", s(args, "event_staff_id")).eq("event_id", s(args, "event_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "events_set_planning_template",
    description: "Switch the planner template. This re-seeds the planner and clears the event's current planner answers.",
    scopes: ["write.planning"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, template_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const templateId = s(args, "template_id");
      if (!templateId) {
        await adminOf(ctx).from("events").update({ planning_template_id: null }).eq("id", s(args, "event_id"));
        return { ok: true, cleared: true };
      }
      await reseedEventPlanning(s(args, "event_id")!, templateId);
      return { ok: true };
    },
  },
  {
    name: "planning_get",
    description: "Read an event's planner: sections, questions, answers, and songs, as staff see them.",
    scopes: ["read.planning"],
    confirm: false,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const plan = await loadEventPlanning(adminOf(ctx), s(args, "event_id")!, "00000000-0000-0000-0000-000000000000", "staff");
      return stripSecrets(plan);
    },
  },
  {
    name: "clients_list",
    description: "List clients. Optional search matches first name, last name, or email.",
    scopes: ["read.clients"],
    confirm: false,
    inputSchema: obj({ q: { type: "string" }, limit: limitProp }),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      let q = admin.from("clients").select("id, first_name, last_name, email, cell_phone, organization").order("first_name").limit(n(args, "limit") || 50);
      const term = s(args, "q");
      if (term) q = q.or(`first_name.ilike.%${term.replace(/[%,()]/g, "")}%,last_name.ilike.%${term.replace(/[%,()]/g, "")}%,email.ilike.%${term.replace(/[%,()]/g, "")}%`);
      const limit = n(args, "limit") || 50;
      const page = pageMeta(await query(q), limit);
      return { clients: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "clients_get",
    description: "Get one client and the events they are the primary client on.",
    scopes: ["read.clients"],
    confirm: false,
    inputSchema: obj({ client_id: UUID }, ["client_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "client_id");
      const [client, events] = await Promise.all([
        query(admin.from("clients").select("*").eq("id", id).maybeSingle()),
        query(admin.from("events").select("id, name, event_date, status_id").eq("client_id", id).order("event_date", { ascending: false }).limit(20)),
      ]);
      if (!client) throw new Error("Client not found.");
      return { client, events };
    },
  },
  {
    name: "clients_create",
    description: "Create a client, or return the existing client when the email already exists.",
    scopes: ["write.clients"],
    confirm: false,
    inputSchema: obj({
      first_name: { type: "string", minLength: 1 },
      last_name: { type: "string" },
      email: { type: "string" },
      cell_phone: { type: "string" },
      organization: { type: "string" },
      notes: { type: "string" },
    }, ["first_name"]),
    async execute(args, ctx) {
      const found = await findOrCreateClient(adminOf(ctx), {
        first_name: s(args, "first_name"),
        last_name: s(args, "last_name"),
        email: s(args, "email"),
        cell_phone: s(args, "cell_phone"),
        organization: s(args, "organization"),
        notes: s(args, "notes"),
      });
      return found;
    },
  },
  {
    name: "clients_update",
    description: "Update a client's contact fields. Empty string clears a field. Does not change their login by itself.",
    scopes: ["write.clients"],
    confirm: false,
    inputSchema: obj({
      client_id: UUID,
      first_name: { type: "string" },
      last_name: { type: "string" },
      email: { type: "string" },
      cell_phone: { type: "string" },
      organization: { type: "string" },
      mailing_address: { type: "string" },
      notes: { type: "string" },
    }, ["client_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      for (const key of ["first_name", "last_name", "email", "cell_phone", "organization", "mailing_address", "notes"]) {
        if (key in args) patch[key] = s(args, key);
      }
      const { error } = await adminOf(ctx).from("clients").update(patch).eq("id", s(args, "client_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "clients_anonymize",
    description: "Irreversible privacy erasure. Scrubs the client's personal details and removes their portal login. The row stays so payments remain attributable.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ client_id: UUID }, ["client_id"]),
    async preview(args) {
      return { client_id: s(args, "client_id"), effect: "Personal details are replaced with Deleted Client and the portal login is removed." };
    },
    async execute(args, ctx) {
      await anonymizeClientRecord(adminOf(ctx), s(args, "client_id")!);
      return { ok: true };
    },
  },
  {
    name: "clients_invite",
    description: "Email the client their XOS invite using the real invite template and set-password link.",
    scopes: ["comms.email"],
    confirm: true,
    inputSchema: obj({ client_id: UUID, event_id: UUID }, ["client_id", "event_id"]),
    async freeze(args, ctx) {
      return clientInviteSnapshot(adminOf(ctx), s(args, "client_id")!);
    },
    async preview(args, ctx) {
      return clientInviteSnapshot(adminOf(ctx), s(args, "client_id")!);
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const { data } = await admin.from("clients").select("first_name, last_name, email").eq("id", s(args, "client_id")).maybeSingle();
      const approved = ctx.approvedSnapshot as { to?: string; body?: string } | null;
      if (!approved?.to || !approved.body) throw new Error("The invite approval is missing. Nothing was sent.");
      const result = await inviteClientToXos({
        clientId: s(args, "client_id")!,
        eventId: s(args, "event_id")!,
        email: data?.email,
        name: `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim(),
        approved: approved?.to && approved.body ? { to: approved.to, body: approved.body } : null,
      });
      if (!result.ok) throw new Error(result.error ?? "Invite failed.");
      return { ok: true };
    },
  },
  {
    name: "clients_reset_password",
    description: "Email a password reset to a client. Does not reveal the password.",
    scopes: ["comms.email"],
    confirm: true,
    inputSchema: obj({ client_id: UUID }, ["client_id"]),
    async freeze(args, ctx) {
      return clientResetSnapshot(adminOf(ctx), s(args, "client_id")!);
    },
    async preview(args, ctx) {
      return clientResetSnapshot(adminOf(ctx), s(args, "client_id")!);
    },
    async execute(args, ctx) {
      const { data } = await adminOf(ctx).from("clients").select("email").eq("id", s(args, "client_id")).maybeSingle();
      const approved = ctx.approvedSnapshot as { to?: string; body?: string } | null;
      if (!approved?.to || !approved.body) throw new Error("The reset approval is missing. Nothing was sent.");
      const result = await sendPasswordReset(data?.email, undefined, { to: approved.to, body: approved.body });
      if (!result.ok) throw new Error(result.error ?? "Could not send the reset.");
      return { ok: true };
    },
  },
  {
    name: "venues_list",
    description: "List venues. Pass archived true to include archived venues.",
    scopes: ["read.venues"],
    confirm: false,
    inputSchema: obj({ q: { type: "string" }, limit: limitProp, archived: { type: "boolean" } }),
    async execute(args, ctx) {
      let q = adminOf(ctx).from("venues").select("id, name, city, state, archived_at").order("name").limit(n(args, "limit") || 50);
      if (args.archived !== true) q = q.is("archived_at", null);
      const term = s(args, "q");
      if (term) q = q.ilike("name", `%${term.replace(/[%]/g, "")}%`);
      const limit = n(args, "limit") || 50;
      const page = pageMeta(await query(q), limit);
      return { venues: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "venues_get",
    description: "Get one venue, its rooms, and how many events use it.",
    scopes: ["read.venues"],
    confirm: false,
    inputSchema: obj({ venue_id: UUID }, ["venue_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "venue_id");
      const [venue, rooms, countRes] = await Promise.all([
        query(admin.from("venues").select("*").eq("id", id).maybeSingle()),
        query(admin.from("venue_rooms").select("id, name").eq("venue_id", id)),
        admin.from("events").select("id", { count: "exact", head: true }).eq("venue_id", id),
      ]);
      return { venue, rooms, event_count: countRes.count ?? 0 };
    },
  },
  {
    name: "venues_create",
    description: "Create a venue with a name and optional city and street address.",
    scopes: ["write.venues"],
    confirm: false,
    inputSchema: obj({ name: { type: "string", minLength: 1 }, city: { type: "string" }, address: { type: "string" } }, ["name"]),
    async execute(args, ctx) {
      const { data, error } = await adminOf(ctx).from("venues").insert({ name: s(args, "name"), city: s(args, "city"), address: s(args, "address") }).select("id").single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    },
  },
  {
    name: "venues_archive",
    description: "Archive or restore venues. Archived venues stay on past events.",
    scopes: ["write.venues"],
    confirm: false,
    inputSchema: obj({ venue_ids: { type: "array", items: UUID }, archive: { type: "boolean" } }, ["venue_ids", "archive"]),
    async execute(args, ctx) {
      const ids = Array.isArray(args.venue_ids) ? args.venue_ids.filter((id): id is string => typeof id === "string") : [];
      const { error } = await adminOf(ctx).from("venues").update({ archived_at: args.archive ? new Date().toISOString() : null }).in("id", ids);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "vendors_list",
    description: "List vendor companies. Optional q matches the company name.",
    scopes: ["read.vendors"],
    confirm: false,
    inputSchema: obj({ q: { type: "string" }, limit: limitProp }),
    async execute(args, ctx) {
      let q = adminOf(ctx).from("vendors").select("id, company_name, category, email, phone").order("company_name").limit(n(args, "limit") || 50);
      const term = s(args, "q");
      if (term) q = q.ilike("company_name", `%${term.replace(/[%]/g, "")}%`);
      const limit = n(args, "limit") || 50;
      const page = pageMeta(await query(q), limit);
      return { vendors: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "vendors_get",
    description: "Get one vendor and its contacts.",
    scopes: ["read.vendors"],
    confirm: false,
    inputSchema: obj({ vendor_id: UUID }, ["vendor_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "vendor_id");
      const [vendor, contacts] = await Promise.all([
        query(admin.from("vendors").select("*").eq("id", id).maybeSingle()),
        query(admin.from("vendor_contacts").select("id, name, email, phone").eq("vendor_id", id)),
      ]);
      return { vendor, contacts };
    },
  },
  {
    name: "vendors_create",
    description: "Create a vendor company.",
    scopes: ["write.vendors"],
    confirm: false,
    inputSchema: obj({ company_name: { type: "string", minLength: 1 }, email: { type: "string" }, phone: { type: "string" } }, ["company_name"]),
    async execute(args, ctx) {
      const { data, error } = await adminOf(ctx).from("vendors").insert({ company_name: s(args, "company_name"), email: s(args, "email"), phone: s(args, "phone") }).select("id").single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    },
  },
  {
    name: "staff_list",
    description: "List employees. Pass active_only to hide people who are deactivated.",
    scopes: ["read.staff"],
    confirm: false,
    inputSchema: obj({ limit: limitProp, active_only: { type: "boolean" } }),
    async execute(args, ctx) {
      let q = adminOf(ctx).from("employees").select("id, first_name, last_name, email, phone, permission_tier, is_active").order("first_name").limit(n(args, "limit") || 80);
      if (args.active_only === true) q = q.eq("is_active", true);
      const limit = n(args, "limit") || 80;
      const page = pageMeta(await query(q), limit);
      return { staff: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "staff_get",
    description: "Get one employee. Wage fields are included only when the token has money.payroll.",
    scopes: ["read.staff"],
    confirm: false,
    inputSchema: obj({ employee_id: UUID }, ["employee_id"]),
    async execute(args, ctx) {
      const cols = ctx.token.scopes.includes("money.payroll")
        ? "*"
        : "id, first_name, last_name, email, phone, permission_tier, staff_category, is_active, stage_name";
      const row = await query(adminOf(ctx).from("employees").select(cols).eq("id", s(args, "employee_id")).maybeSingle());
      if (!row) throw new Error("Employee not found.");
      return { employee: row };
    },
  },
  {
    name: "staff_create",
    description: "Create an employee and sync their HighLevel contact, the same way the staff form does.",
    scopes: ["write.staff"],
    confirm: false,
    inputSchema: obj({
      first_name: { type: "string", minLength: 1 },
      last_name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      permission_tier: { type: "string", enum: ["admin", "salesperson", "employee", "marketing"] },
    }, ["first_name"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const { data, error } = await admin.from("employees").insert({
        first_name: s(args, "first_name"),
        last_name: s(args, "last_name") ?? "",
        email: s(args, "email"),
        phone: s(args, "phone"),
        permission_tier: s(args, "permission_tier") ?? "employee",
      }).select("id").single();
      if (error) throw new Error(error.message);
      try { await syncStaffToHighLevel(admin, data.id); } catch { /* same best-effort as the staff form */ }
      return { id: data.id };
    },
  },
  {
    name: "staff_set_active",
    description: "Activate or deactivate an employee. Does not delete them.",
    scopes: ["write.staff"],
    confirm: false,
    inputSchema: obj({ employee_id: UUID, is_active: { type: "boolean" } }, ["employee_id", "is_active"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("employees").update({ is_active: args.is_active === true }).eq("id", s(args, "employee_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "staff_update_wages",
    description: "Set an employee's hourly rate and commission percents.",
    scopes: ["money.payroll"],
    confirm: true,
    inputSchema: obj({
      employee_id: UUID,
      hourly_rate: { type: "number", minimum: 0 },
      addon_commission_pct: { type: "number", minimum: 0 },
      sales_commission_pct: { type: "number", minimum: 0 },
    }, ["employee_id"]),
    async execute(args, ctx) {
      const patch: Record<string, unknown> = {};
      if (typeof args.hourly_rate === "number") patch.hourly_rate = args.hourly_rate;
      if (typeof args.addon_commission_pct === "number") patch.addon_commission_pct = args.addon_commission_pct;
      if (typeof args.sales_commission_pct === "number") patch.sales_commission_pct = args.sales_commission_pct;
      const { error } = await adminOf(ctx).from("employees").update(patch).eq("id", s(args, "employee_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "staff_invite",
    description: "Email a staff invite so they can set a password. Does not reveal the password.",
    scopes: ["comms.email"],
    confirm: true,
    inputSchema: obj({ employee_id: UUID }, ["employee_id"]),
    async preview(args, ctx) {
      const { data } = await adminOf(ctx).from("employees").select("email, first_name").eq("id", s(args, "employee_id")).maybeSingle();
      return { to: data?.email ?? null, name: data?.first_name ?? null };
    },
    async execute(args, ctx) {
      const { data } = await adminOf(ctx).from("employees").select("email, first_name, last_name").eq("id", s(args, "employee_id")).maybeSingle();
      const result = await sendAccountInvite({
        type: "staff",
        email: data?.email ?? "",
        name: `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim(),
        employeeId: s(args, "employee_id")!,
      });
      if (!result.ok) throw new Error(result.error ?? "Invite failed.");
      return { ok: true };
    },
  },
  {
    name: "packages_list",
    description: "List active packages and add-ons with their default prices.",
    scopes: ["read.catalog"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      const admin = adminOf(ctx);
      const [packages, addons] = await Promise.all([
        query(admin.from("packages").select("id, name, default_price, deposit_value, is_active").order("display_order")),
        query(admin.from("addons").select("id, name, default_price, is_active").order("display_order")),
      ]);
      return { packages, addons };
    },
  },
  {
    name: "equipment_list",
    description: "List equipment items and systems.",
    scopes: ["read.equipment"],
    confirm: false,
    inputSchema: obj({ limit: limitProp }),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const [items, systems] = await Promise.all([
        query(admin.from("equipment_items").select("id, name, system_id").order("name").limit(n(args, "limit") || 80)),
        query(admin.from("equipment_systems").select("id, name").order("name").limit(40)),
      ]);
      const itemLimit = n(args, "limit") || 80;
      const itemPage = pageMeta(items, itemLimit);
      const systemPage = pageMeta(systems, 40);
      return { items: itemPage.items, items_limit: itemPage.limit, items_returned: itemPage.returned, items_may_have_more: itemPage.may_have_more, systems: systemPage.items, systems_limit: systemPage.limit, systems_returned: systemPage.returned, systems_may_have_more: systemPage.may_have_more };
    },
  },
  {
    name: "documents_list",
    description: "List generated documents for an event, or the latest documents overall. Signing tokens are not included.",
    scopes: ["read.documents"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, limit: limitProp }),
    async execute(args, ctx) {
      let q = adminOf(ctx).from("documents").select("id, title, doc_type, status, event_id, signed_at, created_at").order("created_at", { ascending: false }).limit(n(args, "limit") || 30);
      if (s(args, "event_id")) q = q.eq("event_id", s(args, "event_id"));
      const limit = n(args, "limit") || 30;
      const page = pageMeta(await query(q), limit);
      return { documents: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "documents_get",
    description: "Get one generated document's status and title. The signing token is not returned.",
    scopes: ["read.documents"],
    confirm: false,
    inputSchema: obj({ document_id: UUID }, ["document_id"]),
    async execute(args, ctx) {
      const doc = await query(adminOf(ctx).from("documents").select("id, title, doc_type, status, event_id, signed_at, visible_to_client, template_id, created_at").eq("id", s(args, "document_id")).maybeSingle());
      if (!doc) throw new Error("Document not found.");
      return { document: doc };
    },
  },
  {
    name: "documents_generate",
    description: "Generate a document for an event from a template using the real renderer (merge tags included). Does not email it.",
    scopes: ["write.documents"],
    confirm: false,
    inputSchema: obj({ template_id: UUID, event_id: UUID }, ["template_id", "event_id"]),
    async execute(args, ctx) {
      const doc = await generateDocumentRow(adminOf(ctx), s(args, "template_id")!, s(args, "event_id")!);
      if (!doc) throw new Error("Could not render that document.");
      return { id: doc.id, title: doc.title, doc_type: doc.doc_type };
    },
  },
  {
    name: "documents_send_for_signature",
    description: "Send a generated Booking Agreement (or other document) to the client using the app's Send for signature path. The quote, investment, and payment plan are rendered in the app, then the outbox sends the email. Do not try to send this from the database.",
    scopes: ["comms.contract"],
    confirm: true,
    inputSchema: obj({ document_id: UUID }, ["document_id"]),
    async freeze(args, ctx) {
      return previewDocumentSend(adminOf(ctx), s(args, "document_id")!);
    },
    async preview(args, ctx) {
      return previewDocumentSend(adminOf(ctx), s(args, "document_id")!);
    },
    async execute(args, ctx) {
      const fresh = await previewDocumentSend(adminOf(ctx), s(args, "document_id")!);
      if (ctx.approvedEffectHash && sha256(canonicalJson(fresh)) !== ctx.approvedEffectHash) {
        throw new Error("The rendered agreement email changed. Nothing was sent.");
      }
      const sent = await sendDocumentForSignature(adminOf(ctx), s(args, "document_id")!);
      return { ok: true, to: sent.to };
    },
  },
  {
    name: "documents_set_status",
    description: "Set a document's status. Voiding is irreversible for the client.",
    scopes: ["write.documents"],
    confirm: true,
    inputSchema: obj({ document_id: UUID, status: { type: "string", enum: ["draft", "sent", "void"] } }, ["document_id", "status"]),
    async execute(args, ctx) {
      const { data } = await adminOf(ctx).from("documents").select("signed_at").eq("id", s(args, "document_id")).maybeSingle();
      if (data?.signed_at) throw new Error("Signed documents are locked.");
      const { error } = await adminOf(ctx).from("documents").update({ status: s(args, "status"), updated_at: new Date().toISOString() }).eq("id", s(args, "document_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "payments_list",
    description: "List payments and the schedule for an event.",
    scopes: ["money"],
    confirm: false,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "event_id");
      const [payments, schedule] = await Promise.all([
        query(admin.from("payments").select("id, amount, method, reason, status, paid_at, deleted_at, notes").eq("event_id", id).order("paid_at", { ascending: false })),
        query(admin.from("scheduled_payments").select("id, seq, label, amount, due_date").eq("event_id", id).order("seq")),
      ]);
      return { payments, schedule };
    },
  },
  {
    name: "payments_add",
    description: "Record a received payment and run payment-received automations (the Financials tab path). Card captures are not created here.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      amount: { type: "number", minimum: 0.01 },
      method: { type: "string" },
      reason: { type: "string" },
      paid_at: { type: "string" },
      notes: { type: "string" },
    }, ["event_id", "amount"]),
    async authorize(args, ctx) {
      assertEffectScopes(ctx.token.scopes, await collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received"));
    },
    async freeze(args, ctx) {
      return collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received");
    },
    async preview(args, ctx) {
      const effects = await collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received");
      return { will_record: args.amount, method: s(args, "method") ?? "other", effects };
    },
    async execute(args, ctx) {
      await recordPayment(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        amount: n(args, "amount"),
        method: s(args, "method") ?? "other",
        reason: s(args, "reason"),
        paidAt: s(args, "paid_at"),
        notes: s(args, "notes"),
      }, { drain: "event" });
      return { ok: true };
    },
  },
  {
    name: "payments_update",
    description: "Correct a recorded payment. PayPal-captured amounts stay fixed.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({
      payment_id: UUID,
      event_id: UUID,
      amount: { type: "number", minimum: 0.01 },
      method: { type: "string" },
      reason: { type: "string" },
      paid_at: { type: "string" },
      notes: { type: "string" },
    }, ["payment_id", "event_id"]),
    async execute(args, ctx) {
      await updatePaymentRecord(adminOf(ctx), {
        paymentId: s(args, "payment_id")!,
        eventId: s(args, "event_id")!,
        amount: typeof args.amount === "number" ? args.amount : null,
        method: s(args, "method") ?? "other",
        reason: s(args, "reason"),
        paidAt: s(args, "paid_at"),
        notes: s(args, "notes"),
      });
      return { ok: true };
    },
  },
  {
    name: "payments_confirm",
    description: "Approve a pending payment (for example a Zelle claim) and run payment-received automations.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({ payment_id: UUID, event_id: UUID, note: { type: "string" } }, ["payment_id", "event_id"]),
    async authorize(args, ctx) {
      assertEffectScopes(ctx.token.scopes, await collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received"));
    },
    async freeze(args, ctx) {
      return collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received");
    },
    async preview(args, ctx) {
      return { payment_id: s(args, "payment_id"), effects: await collectAutomationEffects(adminOf(ctx), s(args, "event_id")!, "payment_received") };
    },
    async execute(args, ctx) {
      await confirmPaymentRecord(adminOf(ctx), { paymentId: s(args, "payment_id")!, eventId: s(args, "event_id")!, note: s(args, "note") }, { drain: "event" });
      return { ok: true };
    },
  },
  {
    name: "payments_remove",
    description: "Soft-delete a payment so it stops counting toward the balance. It can be restored.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({ payment_id: UUID, event_id: UUID }, ["payment_id", "event_id"]),
    async execute(args, ctx) {
      await softRemovePayment(adminOf(ctx), { paymentId: s(args, "payment_id")!, eventId: s(args, "event_id")!, deletedBy: actor(ctx) });
      return { ok: true };
    },
  },
  {
    name: "payments_restore",
    description: "Restore a soft-deleted payment.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({ payment_id: UUID, event_id: UUID }, ["payment_id", "event_id"]),
    async execute(args, ctx) {
      await restorePaymentRecord(adminOf(ctx), { paymentId: s(args, "payment_id")!, eventId: s(args, "event_id")! });
      return { ok: true };
    },
  },
  {
    name: "payments_save_schedule",
    description: "Rewrite the unpaid part of the payment schedule. Paid installments cannot change, and the open rows must add up to the remaining balance.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      rows: { type: "array", items: obj({ id: UUID, amount: { type: "number", minimum: 0 }, due_date: { type: "string" } }) },
    }, ["event_id", "rows"]),
    async execute(args, ctx) {
      const rows = Array.isArray(args.rows) ? args.rows as { id?: string; amount?: number; due_date?: string }[] : [];
      await saveRemainingScheduleRows(adminOf(ctx), s(args, "event_id")!, rows.map((row) => ({
        id: row.id ?? null,
        amount: Number(row.amount ?? 0),
        due_date: row.due_date ?? null,
      })));
      return { ok: true };
    },
  },
  {
    name: "payments_add_schedule",
    description: "Build a payment schedule from the package's allowed splits, preserving installments that are already paid.",
    scopes: ["money"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      plan: { type: "string" },
      total: { type: "number", minimum: 0 },
      deposit: { type: "number", minimum: 0 },
      event_date: { type: "string" },
    }, ["event_id", "plan", "total"]),
    async execute(args, ctx) {
      const plan = parseSchedulePlan(s(args, "plan"));
      if (!plan) throw new Error("Plan must be full or a split count the package allows.");
      await addScheduledPaymentPlan(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        plan,
        total: n(args, "total"),
        deposit: n(args, "deposit"),
        eventDate: s(args, "event_date"),
      });
      return { ok: true };
    },
  },
  {
    name: "payments_proposal_link",
    description: "Check whether an event has a proposal link. The link itself is not returned to the agent.",
    scopes: ["read.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const { data } = await admin.from("events").select("id").eq("id", s(args, "event_id")).not("pay_token", "is", null).maybeSingle();
      if (!data) throw new Error("This event has no proposal link yet.");
      return { available: true };
    },
  },
  {
    name: "reports_outstanding",
    description: "Outstanding balance report, using the same builder as the payments report.",
    scopes: ["read.reports", "money"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      return stripSecrets(await buildOutstanding(adminOf(ctx)));
    },
  },
  {
    name: "payroll_generate",
    description: "Build payroll payables for a pay period from staff hours and rates. Updates existing auto rows and inserts new ones. Does not pay anyone.",
    scopes: ["money.payroll"],
    confirm: true,
    inputSchema: obj({ payday: { type: "string" }, period_start: { type: "string" }, period_end: { type: "string" } }, ["payday", "period_start", "period_end"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const payday = s(args, "payday")!;
      const { data: events } = await admin.from("events").select("id, setup_time, start_time, end_time, status:event_statuses(counts_payroll), venue:venues(travel_minutes), event_staff(id, employee_id, role, pay_type, flat_wage, start_time, end_time, checked_in_at, checked_out_at, employee:employees(hourly_rate))").is("archived_at", null).gte("event_date", s(args, "period_start")).lte("event_date", s(args, "period_end"));
      const { data: existing } = await admin.from("payroll_payables").select("id, employee_id, event_id").eq("pay_period", payday).eq("source", "auto");
      const existingByKey = new Map((existing ?? []).map((r) => [`${r.employee_id}|${r.event_id}`, r.id as string]));
      const toInsert: Record<string, unknown>[] = [];
      for (const ev of events ?? []) {
        if (!(ev.status as { counts_payroll?: boolean } | null)?.counts_payroll) continue;
        const travel = (ev.venue as { travel_minutes?: number | null } | null)?.travel_minutes ?? 0;
        for (const es of (ev.event_staff ?? []) as Array<{ employee_id: string | null; role: string | null; pay_type: string | null; flat_wage: number | null; start_time: string | null; end_time: string | null; checked_in_at: string | null; checked_out_at: string | null; employee: { hourly_rate?: number | null } | null }>) {
          if (!es.employee_id) continue;
          const hours = staffHours(es, ev, travel, { actual: !!(es.checked_in_at && es.checked_out_at) });
          const cost = staffCost(es, es.employee, hours);
          const key = `${es.employee_id}|${ev.id}`;
          const existingId = existingByKey.get(key);
          if (existingId) await admin.from("payroll_payables").update({ amount_owed: cost, description: es.role }).eq("id", existingId);
          else toInsert.push({ pay_period: payday, payee_kind: "employee", employee_id: es.employee_id, event_id: ev.id, description: es.role, amount_owed: cost, source: "auto" });
        }
      }
      if (toInsert.length) await admin.from("payroll_payables").insert(toInsert);
      return { inserted: toInsert.length };
    },
  },
  {
    name: "payroll_log_payment",
    description: "Record that a payroll payable was paid. This is a money record, not a bank transfer.",
    scopes: ["money.payroll"],
    confirm: true,
    inputSchema: obj({ payable_id: UUID, amount: { type: "number", minimum: 0.01 }, method: { type: "string" }, notes: { type: "string" } }, ["payable_id", "amount"]),
    async execute(args, ctx) {
      const { error } = await adminOf(ctx).from("payroll_payments").insert({
        payable_id: s(args, "payable_id"),
        amount: n(args, "amount"),
        method: s(args, "method"),
        notes: s(args, "notes"),
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "helpers_list",
    description: "List booking helpers and whether they are active. Actions are summarized by type.",
    scopes: ["read.settings"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      const rows = await query(adminOf(ctx).from("booking_helpers").select("id, title, is_active, actions").order("sort_order"));
      const helpers = (Array.isArray(rows) ? rows : []).map((row) => {
        const item = row as { actions?: { type?: string }[] };
        return { ...item, action_types: (item.actions ?? []).map((act) => act.type), actions: undefined };
      });
      return { helpers };
    },
  },
  {
    name: "helpers_preview",
    description: "Preview the texts a booking helper would send for an event, without sending them.",
    scopes: ["helpers.run"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, helper_id: UUID }, ["event_id", "helper_id"]),
    async execute(args, ctx) {
      const prompts = await previewHelperSms(adminOf(ctx), s(args, "event_id")!, s(args, "helper_id")!);
      return { prompts };
    },
  },
  {
    name: "helpers_run",
    description: "Run a booking helper the way the event-page button does: the database queues its actions, then the app outbox fills contract merge tags and sends. Event-type limits still apply. If the helper emails or texts, the token also needs those comms scopes.",
    scopes: ["helpers.run"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      helper_id: UUID,
      sms_overrides: { type: "object" },
    }, ["event_id", "helper_id"]),
    async authorize(args, ctx) {
      await requireHelperScopes(ctx, s(args, "helper_id")!);
    },
    async freeze(args, ctx) {
      const admin = adminOf(ctx);
      const [effects, prompts] = await Promise.all([
        collectHelperEffects(admin, s(args, "helper_id")!),
        previewHelperSms(admin, s(args, "event_id")!, s(args, "helper_id")!),
      ]);
      return { effects, sms_prompts: prompts, sms_overrides: args.sms_overrides ?? null };
    },
    async preview(args, ctx) {
      const admin = adminOf(ctx);
      const [effects, prompts] = await Promise.all([
        collectHelperEffects(admin, s(args, "helper_id")!),
        previewHelperSms(admin, s(args, "event_id")!, s(args, "helper_id")!),
      ]);
      return { effects, sms_prompts: prompts, sms_overrides: args.sms_overrides ?? null };
    },
    async execute(args, ctx) {
      const overrides = args.sms_overrides && typeof args.sms_overrides === "object" ? args.sms_overrides as Record<string, { skip?: boolean; body?: string }> : null;
      const admin = adminOf(ctx);
      const { data, error } = await admin.rpc("mcp_run_helper_claim", {
        p_helper_id: s(args, "helper_id"),
        p_event_id: s(args, "event_id"),
        p_sms: overrides,
      });
      if (error) {
        if (/mcp_run_helper_claim|schema cache|could not find/i.test(error.message)) {
          throw new Error("Running a helper from the agent needs migration 00219. Nothing was sent.");
        }
        throw new Error(error.message);
      }
      const rows = (data ?? []) as { channel: string; id: string; body_sha: string }[];
      const approved = ctx.approvedSnapshot as { effects?: { template_body_sha256?: string | null }[] } | null;
      const approvedHashes = new Set((approved?.effects ?? []).map((effect) => effect.template_body_sha256).filter((hash): hash is string => Boolean(hash)));
      const accepted = [];
      for (const row of rows) {
        if (approvedHashes.size > 0 && !approvedHashes.has(row.body_sha)) {
          const table = row.channel === "sms" ? "sms_log" : "email_log";
          const { error: blockError } = await admin.from(table).update({ status: "blocked", error: "Body is not the approved template. Not returned to the outbox." }).eq("id", row.id);
          if (blockError) throw new Error(blockError.message);
          continue;
        }
        accepted.push(row);
      }
      const emailIds = accepted.filter((row) => row.channel === "email").map((row) => row.id);
      const smsIds = accepted.filter((row) => row.channel === "sms").map((row) => row.id);
      const email = await processOutbox(admin, { onlyIds: emailIds, bodySha256: Object.fromEntries(rows.filter((row) => row.channel === "email").map((row) => [row.id, row.body_sha])) });
      const sms = await processSmsOutbox(admin, { onlyIds: smsIds, bodySha256: Object.fromEntries(rows.filter((row) => row.channel === "sms").map((row) => [row.id, row.body_sha])) });
      return { ok: true, email_ids: emailIds, sms_ids: smsIds, email, sms };
    },
  },
  {
    name: "email_templates_list",
    description: "List active email and SMS templates.",
    scopes: ["read.settings"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      return { templates: await query(adminOf(ctx).from("email_templates").select("id, name, group_name, is_sms, is_active, attach_mode, attach_template_id").eq("is_active", true).order("name")) };
    },
  },
  {
    name: "comms_send_email_template",
    description: "Send one email template for an event. Database merge tags are filled first, then the outbox fills quote, payment-plan, and sign-link tags and attaches the contract when the template is set up that way. A template that attaches a document also needs comms.contract.",
    scopes: ["comms.email"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      template_id: UUID,
      to: { type: "string", enum: ["primary_client", "custom"] },
      address: { type: "string" },
    }, ["event_id", "template_id"]),
    async authorize(args, ctx) {
      const { data } = await adminOf(ctx).from("email_templates").select("attach_template_id").eq("id", s(args, "template_id")).maybeSingle();
      if (data?.attach_template_id && !ctx.token.scopes.includes("comms.contract")) {
        throw new McpScopeError("This template attaches a contract and needs comms.contract.");
      }
    },
    async freeze(args, ctx) {
      return freezeTemplateEmail(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        templateId: s(args, "template_id")!,
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        address: s(args, "address"),
      });
    },
    async preview(args, ctx) {
      return previewTemplateEmail(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        templateId: s(args, "template_id")!,
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        address: s(args, "address"),
      });
    },
    async execute(args, ctx) {
      return sendTemplateEmail(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        templateId: s(args, "template_id")!,
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        address: s(args, "address"),
        expectedHash: ctx.approvedEffectHash,
      });
    },
  },
  {
    name: "comms_send_sms",
    description: "Text the client through the SMS outbox (HighLevel). Pass a body or an SMS template id. Marketing templates still honor the consent gate inside the outbox.",
    scopes: ["comms.sms"],
    confirm: true,
    inputSchema: obj({
      event_id: UUID,
      body: { type: "string", maxLength: 1600 },
      template_id: UUID,
      to: { type: "string", enum: ["primary_client", "custom"] },
      number: { type: "string" },
    }, ["event_id"]),
    async freeze(args, ctx) {
      return previewSms(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        body: s(args, "body"),
        templateId: s(args, "template_id"),
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        number: s(args, "number"),
      });
    },
    async preview(args, ctx) {
      return previewSms(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        body: s(args, "body"),
        templateId: s(args, "template_id"),
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        number: s(args, "number"),
      });
    },
    async execute(args, ctx) {
      return sendSms(adminOf(ctx), {
        eventId: s(args, "event_id")!,
        body: s(args, "body"),
        templateId: s(args, "template_id"),
        to: (s(args, "to") as "primary_client" | "custom") ?? "primary_client",
        number: s(args, "number"),
      });
    },
  },
  {
    name: "comms_drain_outbox",
    description: "Send whatever is already queued in the email and SMS outboxes. This is the same drain the cron uses. It can deliver many client messages.",
    scopes: ["comms.email", "comms.sms"],
    confirm: true,
    inputSchema: obj({}),
    async freeze(_args, ctx) {
      return queuedOutboxSnapshot(adminOf(ctx));
    },
    async preview(_args, ctx) {
      return queuedOutboxSnapshot(adminOf(ctx));
    },
    async execute(_args, ctx) {
      const snapshot = ctx.approvedSnapshot as { email?: { id: string; body?: string | null }[]; sms?: { id: string; body?: string | null }[] } | undefined;
      if (!snapshot) throw new Error("This drain has no approved message list. Nothing was sent.");
      const emailIds = (snapshot.email ?? []).map((row) => row.id);
      const smsIds = (snapshot.sms ?? []).map((row) => row.id);
      const email = await processOutbox(adminOf(ctx), {
        onlyIds: emailIds,
        bodySha256: Object.fromEntries((snapshot.email ?? []).map((row) => [row.id, sha256(row.body ?? "")])),
      });
      const sms = await processSmsOutbox(adminOf(ctx), {
        onlyIds: smsIds,
        bodySha256: Object.fromEntries((snapshot.sms ?? []).map((row) => [row.id, sha256(row.body ?? "")])),
      });
      return { email, sms, claimed_email_ids: emailIds, claimed_sms_ids: smsIds };
    },
  },
  {
    name: "comms_run_scheduled",
    description: "Send the scheduled email and text templates that are due today for one event. The approval lists each rendered message. It does not run the global cron or send other events.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async authorize(args, ctx) {
      const due = await dueScheduledMessages(adminOf(ctx), s(args, "event_id")!);
      const needsEmail = due.some((item) => !item.is_sms);
      const needsSms = due.some((item) => item.is_sms);
      if (needsEmail && !ctx.token.scopes.includes("comms.email")) throw new McpScopeError("A due email needs comms.email.");
      if (needsSms && !ctx.token.scopes.includes("comms.sms")) throw new McpScopeError("A due text needs comms.sms.");
    },
    async freeze(args, ctx) {
      return { messages: await dueScheduledMessages(adminOf(ctx), s(args, "event_id")!) };
    },
    async preview(args, ctx) {
      return { messages: await dueScheduledMessages(adminOf(ctx), s(args, "event_id")!) };
    },
    async execute(args, ctx) {
      const approved = (ctx.approvedSnapshot as { messages?: { template_id: string; is_sms: boolean; to: string | null; subject: string | null; body: string }[] } | undefined)?.messages;
      if (!approved) throw new Error("This scheduled send has no approved message list. Nothing was sent.");
      const fresh = await dueScheduledMessages(adminOf(ctx), s(args, "event_id")!);
      if (sha256(canonicalJson(fresh)) !== sha256(canonicalJson(approved))) {
        throw new Error("A scheduled message changed after approval. Nothing was sent.");
      }
      const admin = adminOf(ctx);
      const emailIds: string[] = [];
      const smsIds: string[] = [];
      for (const message of approved) {
        if (!message.to || !message.body) continue;
        if (message.is_sms) {
          const row = await query(admin.from("sms_log").insert({
            event_id: s(args, "event_id"), to_number: message.to, body: message.body, status: "queued", is_marketing: true, bypass_comms_pause: true,
          }).select("id").single()) as { id: string };
          smsIds.push(row.id);
        } else {
          const row = await query(admin.from("email_log").insert({
            event_id: s(args, "event_id"), to_address: message.to, subject: message.subject ?? "", body_html: message.body, status: "queued", bypass_comms_pause: true,
          }).select("id").single()) as { id: string };
          emailIds.push(row.id);
        }
      }
      const email = await processOutbox(admin, { onlyIds: emailIds });
      const sms = await processSmsOutbox(admin, { onlyIds: smsIds });
      return { email, sms, email_ids: emailIds, sms_ids: smsIds };
    },
  },
  {
    name: "inbox_list",
    description: "List recent inbox conversations.",
    scopes: ["read.inbox"],
    confirm: false,
    inputSchema: obj({ limit: limitProp }),
    async execute(args, ctx) {
      const limit = n(args, "limit") || 40;
      const page = pageMeta(await query(adminOf(ctx).from("hl_conversations").select("id, contact_name, phone, email, last_message_at, last_message_body, unread_count").order("last_message_at", { ascending: false }).limit(limit)), limit);
      return { conversations: page.items, limit: page.limit, returned: page.returned, may_have_more: page.may_have_more };
    },
  },
  {
    name: "inbox_get",
    description: "Read one inbox thread. Does not send a reply.",
    scopes: ["read.inbox"],
    confirm: false,
    inputSchema: obj({ conversation_id: UUID }, ["conversation_id"]),
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "conversation_id");
      const [conversation, messages] = await Promise.all([
        query(admin.from("hl_conversations").select("id, contact_name, phone, email, client_id").eq("id", id).maybeSingle()),
        query(admin.from("hl_messages").select("id, direction, message_type, body, date_added").eq("conversation_id", id).order("date_added", { ascending: true }).limit(200)),
      ]);
      const messagePage = pageMeta(messages, 200);
      return { conversation, messages: messagePage.items, messages_limit: messagePage.limit, messages_returned: messagePage.returned, messages_may_have_more: messagePage.may_have_more };
    },
  },
  {
    name: "inbox_reply",
    description: "Reply in an existing conversation through the SMS/email outbox. Channel Email needs comms.email. Other channels need comms.sms.",
    scopes: ["read.inbox"],
    confirm: true,
    inputSchema: obj({
      conversation_id: UUID,
      body: { type: "string", minLength: 1, maxLength: 4000 },
      channel: { type: "string", enum: ["SMS", "Email", "WhatsApp"] },
      subject: { type: "string" },
    }, ["conversation_id", "body"]),
    async authorize(args, ctx) {
      const channel = s(args, "channel") ?? "SMS";
      const need = channel === "Email" ? "comms.email" : "comms.sms";
      if (!ctx.token.scopes.includes(need)) throw new McpScopeError(`Replying by ${channel} needs ${need}.`);
      if (channel === "SMS") assertSmsBody(s(args, "body") ?? "");
    },
    async freeze(args, ctx) {
      return inboxReplySnapshot(adminOf(ctx), args);
    },
    async preview(args, ctx) {
      return inboxReplySnapshot(adminOf(ctx), args);
    },
    async execute(args, ctx) {
      const admin = adminOf(ctx);
      const id = s(args, "conversation_id")!;
      const channel = (s(args, "channel") ?? "SMS") as "SMS" | "Email" | "WhatsApp";
      const body = channel === "SMS" ? assertSmsBody(s(args, "body") ?? "") : (s(args, "body") ?? "");
      const { data: conv } = await admin.from("hl_conversations").select("id, phone, email, client_id, hl_contact_id").eq("id", id).maybeSingle();
      if (!conv) throw new Error("Conversation not found.");
      if (channel === "SMS" && conv.phone && await isPhoneOptedOut(admin, conv.phone)) {
        throw new Error("This number is opted out (STOP). Nothing was sent.");
      }
      const { data: queued, error } = await admin.from("sms_log").insert({
        client_id: conv.client_id,
        to_number: conv.phone,
        to_address: conv.email,
        channel,
        subject: s(args, "subject"),
        hl_target_contact_id: conv.hl_contact_id,
        body,
        is_marketing: channel === "SMS",
      }).select("id").single();
      if (error) throw new Error(error.message);
      await processSmsOutbox(admin, { onlyIds: [queued.id as string] });
      return { ok: true, classification: channel === "SMS" ? "freeform_is_marketing" : channel };
    },
  },
  {
    name: "settings_overview",
    description: "Read company name, timezone, and email sender identity. Does not return vendor API keys.",
    scopes: ["read.settings"],
    confirm: false,
    inputSchema: obj({}),
    async execute(_args, ctx) {
      const row = await query(adminOf(ctx).from("company_settings").select("company_name, timezone, from_name, from_email, reply_to, email_provider").eq("id", true).maybeSingle());
      return { company: row };
    },
  },
];

const READ_ONLY_TOOLS = new Set([
  "search",
  "events_list",
  "events_get",
  "events_form_options",
  "planning_get",
  "clients_list",
  "clients_get",
  "venues_list",
  "venues_get",
  "vendors_list",
  "vendors_get",
  "staff_list",
  "staff_get",
  "packages_list",
  "equipment_list",
  "documents_list",
  "documents_get",
  "payments_list",
  "payments_proposal_link",
  "reports_outstanding",
  "helpers_list",
  "helpers_preview",
  "email_templates_list",
  "inbox_list",
  "inbox_get",
  "settings_overview",
]);

for (const tool of officeTools) {
  if (!READ_ONLY_TOOLS.has(tool.name)) tool.writes = true;
}
