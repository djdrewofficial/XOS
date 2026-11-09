import {
  decideSmsConsent,
  deleteArticle,
  deleteReminderRule,
  employeePhotoPath,
  linkFirefliesMeeting,
  markConversationRead,
  appInvitePlan,
  removeAppMemberDecision,
  restoreHidden,
  revertOverrideDecision,
  saveCatalogItem,
  saveCompanyMail,
  saveCustomDateDefinition,
  saveEmployeeProfile,
  saveEquipmentCatalog,
  saveEmailTemplateLifecycle,
  saveExpenseLists,
  savePayrollSettings,
  savePhotoboothAdmin,
  savePlannerTemplateAdmin,
  saveManualPayable,
  saveHelperLifecycle,
  saveNamedRow,
  saveNotificationAudience,
  savePaymentSettings,
  saveSigningFields,
  saveSmsConsent,
  saveStaffSettings,
  saveVenueMileage,
  setArticleActive,
} from "@/lib/officeRemaining";
import type { EditorDb } from "@/lib/officeEdits";
import type { LiveTool } from "../protocol";
import type { ToolContext } from "../types";
import type { JsonSchema } from "../validate";

const UUID: JsonSchema = { type: "string", format: "uuid" };
const STR: JsonSchema = { type: "string" };

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}
function db(ctx: ToolContext): EditorDb {
  return ctx.admin as unknown as EditorDb;
}
function s(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const remainingTools: LiveTool[] = [
  {
    name: "employees_profile",
    description: "Update an employee name, contact, or bio. Permission tier, login, and send-as-self are rejected.",
    scopes: ["write.staff"],
    confirm: true,
    inputSchema: obj({ employee_id: UUID, section: { type: "string", enum: ["general", "contact"] }, fields_json: STR }, ["employee_id", "section", "fields_json"]),
    async execute(args, ctx) {
      return saveEmployeeProfile(db(ctx), s(args, "employee_id")!, s(args, "section")!, JSON.parse(s(args, "fields_json") || "{}"));
    },
  },
  {
    name: "employees_photo",
    description: "Store a staff photo from bounded PNG, JPEG, or WebP bytes under that employee id.",
    scopes: ["write.staff"],
    confirm: true,
    inputSchema: obj({ employee_id: UUID, filename: STR, content_type: STR, content_base64: STR }, ["employee_id", "filename", "content_type", "content_base64"]),
    async execute(args, ctx) {
      const planned = employeePhotoPath(s(args, "employee_id")!, s(args, "filename")!, s(args, "content_type")!);
      const bytes = Buffer.from(s(args, "content_base64")!, "base64");
      if (bytes.length === 0 || bytes.length > 192_000) throw new Error("Photo must be between 1 byte and 192 KB.");
      const { error: uploadError } = await ctx.admin.storage.from("staff").upload(planned.path, bytes, { contentType: planned.contentType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { error } = await ctx.admin.from("employees").update({ photo_path: planned.path }).eq("id", s(args, "employee_id"));
      if (error) throw new Error(error.message);
      return { path: planned.path };
    },
  },
  {
    name: "vendors_category",
    description: "Create, rename, or delete a vendor category.",
    scopes: ["write.vendors"],
    confirm: true,
    inputSchema: obj({ category_id: UUID, name: STR, is_active: { type: "boolean" }, delete: { type: "boolean" } }, []),
    async execute(args, ctx) {
      return saveNamedRow(db(ctx), "vendor_categories", { id: s(args, "category_id"), name: s(args, "name") ?? undefined, isActive: args.is_active !== false, delete: args.delete === true });
    },
  },
  {
    name: "clients_sms_consent",
    description: "Record a staff note of what the client said about texts. Marketing consent does not clear STOP. The source must be staff_record.",
    scopes: ["write.clients"],
    confirm: true,
    inputSchema: obj({
      client_id: UUID,
      action: { type: "string", enum: ["opt_out", "clear_stop", "grant_marketing", "revoke_marketing"] },
      evidence: STR,
      source: { type: "string", enum: ["staff_record"] },
      stated_at: STR,
    }, ["client_id", "action", "evidence", "source", "stated_at"]),
    async freeze(args, ctx) {
      const client = await ctx.admin.from("clients").select("cell_phone").eq("id", s(args, "client_id")).maybeSingle();
      if (client.error) throw new Error(client.error.message);
      const phone = (client.data as { cell_phone?: string | null } | null)?.cell_phone ?? null;
      const stop = phone ? await ctx.admin.from("sms_opt_outs").select("opted_out, source, signal_at").eq("phone", phone).maybeSingle() : { data: null, error: null };
      if (stop.error) throw new Error(stop.error.message);
      const stopped = (stop.data as { opted_out?: boolean } | null)?.opted_out === true;
      const decision = decideSmsConsent({ action: s(args, "action")!, evidence: s(args, "evidence"), source: s(args, "source"), statedAt: s(args, "stated_at"), currentlyStopped: stopped });
      return { ...decision, phone, currently_stopped: stopped, will_write: true };
    },
    async preview(args, ctx) {
      return remainingTools.find((tool) => tool.name === "clients_sms_consent")!.freeze!(args, ctx);
    },
    async execute(args, ctx) {
      const snap = ctx.approvedSnapshot as { action?: string; evidence?: string; statedAt?: string; currently_stopped?: boolean; phone?: string | null } | null;
      if (!snap?.evidence || !snap.statedAt || !snap.action) throw new Error("The consent approval is missing. Nothing was saved.");
      const client = await ctx.admin.from("clients").select("cell_phone").eq("id", s(args, "client_id")).maybeSingle();
      if (client.error) throw new Error(client.error.message);
      const phone = (client.data as { cell_phone?: string | null } | null)?.cell_phone ?? null;
      const stop = phone ? await ctx.admin.from("sms_opt_outs").select("opted_out").eq("phone", phone).maybeSingle() : { data: null, error: null };
      if (stop.error) throw new Error(stop.error.message);
      const stopped = (stop.data as { opted_out?: boolean } | null)?.opted_out === true;
      if (stopped !== snap.currently_stopped) throw new Error("The STOP state changed after approval. Nothing was saved.");
      return saveSmsConsent(db(ctx), s(args, "client_id")!, { action: snap.action, evidence: snap.evidence, source: "staff_record", statedAt: snap.statedAt }, { phone, stopped });
    },
  },
  {
    name: "payment_reminders_delete",
    description: "Delete one payment reminder rule. This does not run the reminder pass.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ rule_id: UUID }, ["rule_id"]),
    async execute(args, ctx) {
      return deleteReminderRule(db(ctx), s(args, "rule_id")!);
    },
  },
  {
    name: "assistant_article_status",
    description: "Activate, hide, or delete an assistant article.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ article_id: UUID, is_active: { type: "boolean" }, delete: { type: "boolean" } }, ["article_id"]),
    async execute(args, ctx) {
      if (args.delete === true) return deleteArticle(db(ctx), s(args, "article_id")!);
      return setArticleActive(db(ctx), s(args, "article_id")!, args.is_active === true);
    },
  },
  {
    name: "content_restore",
    description: "Clear the hidden flag on one piece of client content that belongs to the event.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, target_type: STR, target_id: UUID, target_user_id: UUID }, ["event_id", "target_type", "target_id"]),
    async execute(args, ctx) {
      return restoreHidden(db(ctx), s(args, "event_id")!, s(args, "target_type")!, s(args, "target_id")!, s(args, "target_user_id"));
    },
  },
  {
    name: "app_invites_send",
    description: "Resend an invite, replace a join link, or email the join code. The secret is not returned to the agent.",
    scopes: ["comms.email", "write.events"],
    confirm: true,
    inputSchema: obj({ kind: { type: "string", enum: ["resend", "reset_link", "email_code"] }, event_id: UUID, invite_id: UUID, role: { type: "string", enum: ["host", "guest"] } }, ["kind", "event_id"]),
    async freeze(args) {
      return appInvitePlan(s(args, "kind")!);
    },
    async preview(args) {
      return appInvitePlan(s(args, "kind")!);
    },
    async execute(args, ctx) {
      const plan = appInvitePlan(s(args, "kind")!);
      const snap = ctx.approvedSnapshot as { kind?: string } | null;
      if (snap?.kind !== plan.kind) throw new Error("The invite approval is missing. Nothing was sent.");
      const { resendEventInvite, resetJoinLink, emailJoinCodeToHolder } = await import("@/lib/eventAccessServer");
      const eventId = s(args, "event_id")!;
      if (plan.kind === "resend") {
        await resendEventInvite({ eventId, inviteId: s(args, "invite_id")!, userId: "00000000-0000-4000-8000-000000000000" });
        return { ok: true, returns_secret: false };
      }
      if (plan.kind === "reset_link") {
        await resetJoinLink(eventId, (s(args, "role") ?? "host") as "host" | "guest", "00000000-0000-4000-8000-000000000000");
        return { ok: true, returns_secret: false };
      }
      const sent = await emailJoinCodeToHolder({ eventId, userId: "00000000-0000-4000-8000-000000000000", reset: false });
      return { ok: true, emailed: sent.emailed, returns_secret: false };
    },
  },
  {
    name: "app_members_remove",
    description: "Remove a couple-app member who is not the contract holder or primary client.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, client_id: UUID }, ["event_id", "client_id"]),
    async execute(args, ctx) {
      const [row, event] = await Promise.all([
        ctx.admin.from("event_clients").select("is_contract_holder, is_primary").eq("event_id", s(args, "event_id")).eq("client_id", s(args, "client_id")).maybeSingle(),
        ctx.admin.from("events").select("client_id").eq("id", s(args, "event_id")).maybeSingle(),
      ]);
      if (row.error) throw new Error(row.error.message);
      if (event.error) throw new Error(event.error.message);
      const member = row.data as { is_contract_holder?: boolean; is_primary?: boolean } | null;
      const anchor = (event.data as { client_id?: string | null } | null)?.client_id;
      removeAppMemberDecision({ onEvent: Boolean(member), isContractHolder: member?.is_contract_holder === true, isPrimary: member?.is_primary === true, isAnchor: anchor === s(args, "client_id") });
      const { error } = await ctx.admin.from("event_clients").delete().eq("event_id", s(args, "event_id")).eq("client_id", s(args, "client_id"));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "signing_requirements",
    description: "Set the global fields required before a client can sign. Unknown fields are rejected.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ fields_json: STR }, ["fields_json"]),
    async execute(args, ctx) {
      return saveSigningFields(db(ctx), JSON.parse(s(args, "fields_json") || "[]"));
    },
  },
  {
    name: "staff_settings_save",
    description: "Save staff feature, payroll display, notification, or sort settings. Permission fields are rejected.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ section: { type: "string", enum: ["features", "payroll", "notifications", "sort"] }, fields_json: STR }, ["section", "fields_json"]),
    async execute(args, ctx) {
      return saveStaffSettings(db(ctx), s(args, "section")!, JSON.parse(s(args, "fields_json") || "{}"));
    },
  },
  {
    name: "payment_settings_save",
    description: "Save payment methods, reasons, and the PayPal fee percent. API secrets are not accepted.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ fields_json: STR }, ["fields_json"]),
    async execute(args, ctx) {
      return savePaymentSettings(db(ctx), JSON.parse(s(args, "fields_json") || "{}"));
    },
  },
  {
    name: "company_mail_settings",
    description: "Save public social links and the email send window. Links must be https.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ facebook: STR, instagram: STR, window_start: STR, window_end: STR }, []),
    async execute(args, ctx) {
      return saveCompanyMail(db(ctx), { facebook: s(args, "facebook"), instagram: s(args, "instagram"), windowStart: s(args, "window_start"), windowEnd: s(args, "window_end") });
    },
  },
  {
    name: "venues_mileage",
    description: "Set whether a venue adds mileage and its one-way miles.",
    scopes: ["write.venues"],
    confirm: true,
    inputSchema: obj({ venue_id: UUID, enabled: { type: "boolean" }, miles: { type: "number" } }, ["venue_id"]),
    async execute(args, ctx) {
      return saveVenueMileage(db(ctx), s(args, "venue_id")!, { enabled: args.enabled === true, miles: typeof args.miles === "number" ? args.miles : null });
    },
  },
  {
    name: "catalog_items",
    description: "Create, rename, reprice, or delete a package or add-on. Deleting a package that events use is still refused by the database.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({ table: { type: "string", enum: ["packages", "addons"] }, item_id: UUID, name: STR, price: { type: "number" }, delete: { type: "boolean" } }, ["table"]),
    async execute(args, ctx) {
      const table = s(args, "table") as "packages" | "addons";
      return saveCatalogItem(db(ctx), table, { id: s(args, "item_id"), name: s(args, "name") ?? undefined, price: typeof args.price === "number" ? args.price : 0, delete: args.delete === true });
    },
  },
  {
    name: "equipment_catalog",
    description: "Create or rename an equipment item or system, assign an item to a system, or add a storage location.",
    scopes: ["write.equipment"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["item", "system", "assign", "location"] }, item_id: UUID, name: STR, system_id: UUID }, ["action"]),
    async execute(args, ctx) {
      return saveEquipmentCatalog(db(ctx), { action: s(args, "action")!, id: s(args, "item_id"), name: s(args, "name") ?? undefined, systemId: s(args, "system_id") });
    },
  },
  {
    name: "custom_date_fields",
    description: "Add a custom date field definition the office can fill on events.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ name: STR }, ["name"]),
    async execute(args, ctx) {
      return saveCustomDateDefinition(db(ctx), s(args, "name")!);
    },
  },
  {
    name: "inbox_mark_read",
    description: "Mark one inbox conversation read. This does not send a message.",
    scopes: ["read.inbox"],
    confirm: true,
    inputSchema: obj({ conversation_id: UUID }, ["conversation_id"]),
    async execute(args, ctx) {
      return markConversationRead(db(ctx), s(args, "conversation_id")!);
    },
  },
  {
    name: "fireflies_link",
    description: "Attach a Fireflies meeting to an event or clear that link. This does not call Fireflies.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, meeting_id: UUID, unlink: { type: "boolean" } }, ["event_id", "meeting_id"]),
    async execute(args, ctx) {
      return linkFirefliesMeeting(db(ctx), s(args, "event_id")!, s(args, "meeting_id")!, args.unlink === true);
    },
  },
  {
    name: "scheduled_comms_revert",
    description: "Remove a scheduled-message override that has not been sent.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, template_id: UUID, target_date: STR }, ["event_id", "template_id", "target_date"]),
    async execute(args, ctx) {
      const eventId = s(args, "event_id")!;
      const templateId = s(args, "template_id")!;
      const targetDate = s(args, "target_date")!;
      const loaded = await ctx.admin.from("scheduled_email_runs").select("status, override_body_html, override_subject").eq("event_id", eventId).eq("template_id", templateId).eq("target_date", targetDate).maybeSingle();
      if (loaded.error) throw new Error(loaded.error.message);
      const run = loaded.data as { status?: string; override_body_html?: string | null; override_subject?: string | null } | null;
      const mode = revertOverrideDecision(run?.status ?? null, Boolean(run?.override_body_html || run?.override_subject));
      if (mode === "delete") {
        const { error } = await ctx.admin.from("scheduled_email_runs").delete().eq("event_id", eventId).eq("template_id", templateId).eq("target_date", targetDate).eq("status", "pending");
        if (error) throw new Error(error.message);
      } else {
        const { error } = await ctx.admin.from("scheduled_email_runs").update({ override_subject: null, override_body_html: null, edited_at: null }).eq("event_id", eventId).eq("template_id", templateId).eq("target_date", targetDate);
        if (error) throw new Error(error.message);
      }
      return { mode };
    },
  },
  {
    name: "helpers_lifecycle",
    description: "Create, copy, move, or delete a booking helper. A new helper starts inactive with no actions.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["create", "duplicate", "delete", "move"] }, helper_id: UUID, title: STR, position: { type: "integer" } }, ["action"]),
    async execute(args, ctx) {
      return saveHelperLifecycle(db(ctx), { action: s(args, "action")!, id: s(args, "helper_id"), title: s(args, "title") ?? undefined, position: typeof args.position === "number" ? args.position : undefined });
    },
  },
  {
    name: "notification_audiences",
    description: "Add or remove one notification audience. Email and SMS channels stay off until a person edits them in the office.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ type_key: STR, audience: STR, enabled: { type: "boolean" }, delete: { type: "boolean" } }, ["type_key", "audience"]),
    async execute(args, ctx) {
      return saveNotificationAudience(db(ctx), { typeKey: s(args, "type_key")!, audience: s(args, "audience")!, enabled: args.enabled === true, delete: args.delete === true });
    },
  },
  {
    name: "expense_lists",
    description: "Replace the expense category option list.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ categories_json: STR }, ["categories_json"]),
    async execute(args, ctx) {
      return saveExpenseLists(db(ctx), JSON.parse(s(args, "categories_json") || "[]"));
    },
  },
  {
    name: "directory_labels",
    description: "Create, rename, or delete a client role or event type label.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ table: { type: "string", enum: ["client_roles", "event_types"] }, row_id: UUID, name: STR, delete: { type: "boolean" } }, ["table"]),
    async execute(args, ctx) {
      const table = s(args, "table")!;
      return saveNamedRow(db(ctx), table, { id: s(args, "row_id"), name: s(args, "name") ?? undefined, delete: args.delete === true });
    },
  },
  {
    name: "payroll_settings_save",
    description: "Save the payroll frequency and anchor payday, or add or delete a manual payable.",
    scopes: ["money.payroll"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["settings", "add", "delete"] }, frequency: STR, anchor: STR, payable_id: UUID, employee_id: UUID, amount: { type: "number" } }, ["action"]),
    async execute(args, ctx) {
      const action = s(args, "action");
      if (action === "settings") return savePayrollSettings(db(ctx), { frequency: s(args, "frequency") ?? undefined, anchor: s(args, "anchor") });
      return saveManualPayable(db(ctx), { id: s(args, "payable_id"), employeeId: s(args, "employee_id") ?? undefined, amount: typeof args.amount === "number" ? args.amount : undefined, delete: action === "delete" });
    },
  },
  {
    name: "email_template_lifecycle",
    description: "Create, copy, or hide an email template. A new template is inactive and empty. This does not send it.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["create", "duplicate", "delete"] }, template_id: UUID, name: STR }, ["action"]),
    async execute(args, ctx) {
      return saveEmailTemplateLifecycle(db(ctx), { action: s(args, "action")!, id: s(args, "template_id"), name: s(args, "name") ?? undefined });
    },
  },
  {
    name: "planner_template_admin",
    description: "Create a planner template, make one the default, or delete one. Questions and sections stay on their own tools.",
    scopes: ["write.planning"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["create", "default", "delete"] }, template_id: UUID, name: STR }, ["action"]),
    async execute(args, ctx) {
      return savePlannerTemplateAdmin(db(ctx), { action: s(args, "action")!, id: s(args, "template_id"), name: s(args, "name") ?? undefined });
    },
  },
  {
    name: "photobooth_admin",
    description: "Activate, reorder, or delete a photo booth backdrop. Image bytes use the bounded upload path.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["active", "order", "delete"] }, backdrop_id: UUID, active: { type: "boolean" }, sort: { type: "integer" } }, ["action", "backdrop_id"]),
    async execute(args, ctx) {
      return savePhotoboothAdmin(db(ctx), { action: s(args, "action")!, id: s(args, "backdrop_id"), active: args.active === true, sort: typeof args.sort === "number" ? args.sort : undefined });
    },
  },
];

for (const tool of remainingTools) tool.writes = true;
