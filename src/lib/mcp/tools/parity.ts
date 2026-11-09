import type { SupabaseClient } from "@supabase/supabase-js";
import { fireHelperWebhook } from "@/lib/automations";
import { processSmsOutbox } from "@/lib/highlevel";
import { processOutbox } from "@/lib/mailgun";
import {
  acceptEventUpload,
  categoryIsEmpty,
  deleteEventFileRow,
  deleteTimeOff,
  heldDeliveryPlan,
  planJobLaunch,
  releaseHeld,
  revokeAppInvite,
  saveAddonCategory,
  saveAddonEquipmentDefaults,
  saveAiTask,
  saveBlackout,
  saveBriefingGlobal,
  saveCustomTag,
  saveDailyStatusAction,
  saveEmailSignature,
  saveEquipmentFlags,
  saveEventFileRow,
  saveFileLabel,
  saveMileageSettings,
  saveModerationStatus,
  savePackageCategory,
  saveReminderRule,
  saveTimeOff,
  saveVenueCategory,
  saveVenueRoom,
  setEventFileLabel,
  setTimeOffStatus,
} from "@/lib/officeParity";
import type { EditorDb } from "@/lib/officeEdits";
import { sendMorningBriefing } from "@/lib/morningBriefing";
import { sendStaffBriefings } from "@/lib/staffBriefing";
import { runVendorMatching } from "@/lib/vendorMatch";
import type { LiveTool } from "../protocol";
import { McpScopeError, type ToolContext } from "../types";
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

async function rows(admin: SupabaseClient, table: "email_log" | "sms_log", eventId: string) {
  const body = table === "email_log" ? "body_html" : "body";
  const to = table === "email_log" ? "to_address" : "to_number";
  const { data, error } = await admin.from(table).select(`id, status, ${body}, ${to}`).eq("event_id", eventId).in("status", ["held", "queued"]);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; status: string; body_html?: string | null; body?: string | null; to_address?: string | null; to_number?: string | null }[];
}

export const parityTools: LiveTool[] = [
  {
    name: "events_file_upload",
    description: "Upload an event file from bounded base64 or a staged path already stored under that event. No remote URL is fetched.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, filename: STR, content_type: STR, content_base64: STR, staged_path: STR, label_id: UUID }, ["event_id", "filename", "content_type"]),
    async execute(args, ctx) {
      const eventId = s(args, "event_id")!;
      const planned = acceptEventUpload({ eventId, filename: s(args, "filename")!, contentType: s(args, "content_type")!, contentBase64: s(args, "content_base64"), stagedPath: s(args, "staged_path") });
      const admin = ctx.admin;
      if (planned.bytes) {
        const { error } = await admin.storage.from("event-files").upload(planned.path, planned.bytes, { contentType: planned.contentType, upsert: false });
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await admin.storage.from("event-files").download(planned.path);
        if (error || !data) throw new Error(error?.message ?? "That staged file is not in event storage.");
      }
      await saveEventFileRow(db(ctx), { event_id: eventId, name: planned.filename, path: planned.path, content_type: planned.contentType, size_bytes: planned.bytes?.length ?? null, source: planned.bytes ? "agent" : "staged", label_id: s(args, "label_id") });
      return { ok: true, path: planned.path };
    },
  },
  {
    name: "events_file_label",
    description: "Set or clear the label on an event file that belongs to that event.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, file_id: UUID, label_id: UUID }, ["event_id", "file_id"]),
    async execute(args, ctx) {
      return setEventFileLabel(db(ctx), s(args, "event_id")!, s(args, "file_id")!, s(args, "label_id"));
    },
  },
  {
    name: "events_file_delete",
    description: "Delete an event file row and its stored object when the file belongs to that event.",
    scopes: ["delete"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, file_id: UUID }, ["event_id", "file_id"]),
    async execute(args, ctx) {
      const removed = await deleteEventFileRow(db(ctx), s(args, "event_id")!, s(args, "file_id")!);
      if (typeof removed.path === "string") {
        const { error } = await ctx.admin.storage.from("event-files").remove([removed.path]);
        if (error) throw new Error(error.message);
      }
      return { ok: true };
    },
  },
  {
    name: "file_labels_save",
    description: "Create a file label and its document attach tag. Both writes must succeed.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ name: STR, sort_order: { type: "integer" } }, ["name"]),
    async execute(args, ctx) {
      return saveFileLabel(db(ctx), { name: s(args, "name")!, sortOrder: typeof args.sort_order === "number" ? args.sort_order : 0 });
    },
  },
  {
    name: "events_equipment_flags",
    description: "Mark event equipment packed or save its notes. The row must belong to the event.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, row_id: UUID, packed: { type: "boolean" }, notes: STR }, ["event_id", "row_id"]),
    async execute(args, ctx) {
      return saveEquipmentFlags(db(ctx), s(args, "event_id")!, s(args, "row_id")!, { packed: typeof args.packed === "boolean" ? args.packed : undefined, notes: "notes" in args ? s(args, "notes") : undefined });
    },
  },
  {
    name: "staff_time_off",
    description: "Add, update, or delete an employee time off row. A pending row is the request the office already notifies.",
    scopes: ["write.staff"],
    confirm: true,
    inputSchema: obj({ employee_id: UUID, time_off_id: UUID, action: { type: "string", enum: ["add", "status", "delete"] }, start_date: STR, end_date: STR, status: STR, notes: STR }, ["employee_id", "action"]),
    async execute(args, ctx) {
      const employeeId = s(args, "employee_id")!;
      const action = s(args, "action");
      if (action === "delete") return deleteTimeOff(db(ctx), employeeId, s(args, "time_off_id")!);
      if (action === "status") return setTimeOffStatus(db(ctx), employeeId, s(args, "time_off_id")!, s(args, "status") ?? "");
      return saveTimeOff(db(ctx), employeeId, { startDate: s(args, "start_date") ?? "", endDate: s(args, "end_date"), status: s(args, "status") ?? undefined, notes: s(args, "notes") });
    },
  },
  {
    name: "catalog_categories",
    description: "Create, rename, or delete a package, add-on, or venue category. A category that still has rows cannot be deleted.",
    scopes: [],
    confirm: true,
    inputSchema: obj({ kind: { type: "string", enum: ["package", "addon", "venue"] }, category_id: UUID, name: STR, is_active: { type: "boolean" }, delete: { type: "boolean" } }, ["kind"]),
    async authorize(args, ctx) {
      const need = s(args, "kind") === "venue" ? "write.venues" : "write.catalog";
      if (!ctx.token.scopes.includes(need)) throw new McpScopeError(`This category edit needs ${need}.`);
    },
    async execute(args, ctx) {
      const kind = s(args, "kind");
      const input = { id: s(args, "category_id"), name: s(args, "name") ?? undefined, isActive: args.is_active !== false, delete: args.delete === true };
      if (input.delete && kind === "package") await categoryIsEmpty(db(ctx), "packages", "category_id", input.id!);
      if (input.delete && kind === "addon") await categoryIsEmpty(db(ctx), "addons", "category_id", input.id!);
      if (kind === "package") return savePackageCategory(db(ctx), input);
      if (kind === "addon") return saveAddonCategory(db(ctx), input);
      if (kind === "venue") return saveVenueCategory(db(ctx), input);
      throw new Error("Category kind is not recognized.");
    },
  },
  {
    name: "addons_equipment_defaults",
    description: "Replace the equipment that is added with an add-on. The previous rows are cleared only if that delete succeeds.",
    scopes: ["write.catalog"],
    confirm: true,
    inputSchema: obj({ addon_id: UUID, rows_json: STR }, ["addon_id", "rows_json"]),
    async execute(args, ctx) {
      const rows = JSON.parse(s(args, "rows_json") || "[]") as { itemId?: string; systemId?: string; quantity: number }[];
      return saveAddonEquipmentDefaults(db(ctx), s(args, "addon_id")!, rows);
    },
  },
  {
    name: "venues_room",
    description: "Add a named room to a venue.",
    scopes: ["write.venues"],
    confirm: false,
    inputSchema: obj({ venue_id: UUID, name: STR }, ["venue_id", "name"]),
    async execute(args, ctx) {
      return saveVenueRoom(db(ctx), s(args, "venue_id")!, s(args, "name")!);
    },
  },
  {
    name: "payment_reminder_rules",
    description: "Create or update a payment reminder rule. Running the reminder batch is a separate approved job.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ rule_id: UUID, when: { type: "string", enum: ["before", "on", "after"] }, days: { type: "integer" }, send_email: { type: "boolean" }, send_sms: { type: "boolean" }, email_template_id: UUID, sms_template_id: UUID, is_active: { type: "boolean" } }, ["when"]),
    async execute(args, ctx) {
      return saveReminderRule(db(ctx), s(args, "rule_id"), { when: s(args, "when")!, days: typeof args.days === "number" ? args.days : 0, sendEmail: args.send_email === true, sendSms: args.send_sms === true, emailTemplateId: s(args, "email_template_id"), smsTemplateId: s(args, "sms_template_id"), isActive: args.is_active !== false });
    },
  },
  {
    name: "merge_tags_save",
    description: "Create, update, or delete a custom merge tag. Built-in tags cannot be deleted.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ tag_id: UUID, tag_key: STR, label: STR, source_type: STR, source_value: STR, delete: { type: "boolean" } }, []),
    async execute(args, ctx) {
      return saveCustomTag(db(ctx), { id: s(args, "tag_id"), tagKey: s(args, "tag_key") ?? undefined, label: s(args, "label") ?? undefined, sourceType: s(args, "source_type") ?? undefined, sourceValue: s(args, "source_value"), delete: args.delete === true });
    },
  },
  {
    name: "mileage_settings",
    description: "Save the company mileage rate, round trip flag, and category.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ enabled: { type: "boolean" }, rate: { type: "number" }, round_trip: { type: "boolean" }, category_id: UUID }, []),
    async execute(args, ctx) {
      return saveMileageSettings(db(ctx), { enabled: args.enabled === true, rate: typeof args.rate === "number" ? args.rate : 0.7, roundTrip: args.round_trip === true, categoryId: s(args, "category_id") });
    },
  },
  {
    name: "daily_status_actions",
    description: "Create, update, or delete a daily status rollover. This does not run the daily job.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ action_id: UUID, trigger: STR, from_status_id: UUID, to_status_id: UUID, is_active: { type: "boolean" }, delete: { type: "boolean" } }, []),
    async execute(args, ctx) {
      return saveDailyStatusAction(db(ctx), { id: s(args, "action_id"), trigger: s(args, "trigger") ?? undefined, fromStatusId: s(args, "from_status_id") ?? undefined, toStatusId: s(args, "to_status_id") ?? undefined, isActive: args.is_active !== false, delete: args.delete === true });
    },
  },
  {
    name: "email_signature_save",
    description: "Save the company email signature HTML. Scripts are rejected.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ html: STR }, ["html"]),
    async execute(args, ctx) {
      return saveEmailSignature(db(ctx), s(args, "html") ?? "");
    },
  },
  {
    name: "email_blackouts",
    description: "Add or delete an email blackout date.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ blackout_id: UUID, day: STR, label: STR, delete: { type: "boolean" } }, []),
    async execute(args, ctx) {
      return saveBlackout(db(ctx), { id: s(args, "blackout_id"), day: s(args, "day") ?? undefined, label: s(args, "label"), delete: args.delete === true });
    },
  },
  {
    name: "content_moderation",
    description: "Resolve or dismiss a content report on an event.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, report_id: UUID, status: { type: "string", enum: ["resolved", "dismissed"] } }, ["event_id", "report_id", "status"]),
    async execute(args, ctx) {
      return saveModerationStatus(db(ctx), s(args, "event_id")!, s(args, "report_id")!, s(args, "status")!);
    },
  },
  {
    name: "briefing_settings",
    description: "Turn the staff briefing on or off and set its hour. This does not send it.",
    scopes: ["write.settings"],
    confirm: false,
    inputSchema: obj({ enabled: { type: "boolean" }, hour: { type: "integer" } }, []),
    async execute(args, ctx) {
      return saveBriefingGlobal(db(ctx), { enabled: typeof args.enabled === "boolean" ? args.enabled : undefined, hour: typeof args.hour === "number" ? args.hour : undefined });
    },
  },
  {
    name: "ai_tasks_save",
    description: "Save whether a morning briefing, vendor matching, or staff briefing task is enabled and when it runs.",
    scopes: ["write.settings"],
    confirm: true,
    inputSchema: obj({ key: STR, enabled: { type: "boolean" }, hour: { type: "integer" }, recipients: STR }, ["key"]),
    async execute(args, ctx) {
      return saveAiTask(db(ctx), s(args, "key")!, { enabled: args.enabled === true, hour: typeof args.hour === "number" ? args.hour : 7, recipients: s(args, "recipients") });
    },
  },
  {
    name: "jobs_launch",
    description: "Launch the staff briefing, the company morning briefing, or vendor matching after the plan is approved.",
    scopes: [],
    confirm: true,
    inputSchema: obj({ key: { type: "string", enum: ["staff_briefings", "morning_briefing", "vendor_matching"] } }, ["key"]),
    async authorize(args, ctx) {
      const plan = planJobLaunch(s(args, "key")!);
      const need = plan.sends ? "comms.email" : "write.settings";
      if (!ctx.token.scopes.includes(need)) throw new McpScopeError(`This job needs ${need}.`);
    },
    async freeze(args) {
      return planJobLaunch(s(args, "key")!);
    },
    async preview(args) {
      return planJobLaunch(s(args, "key")!);
    },
    async execute(args, ctx) {
      const plan = planJobLaunch(s(args, "key")!);
      if (plan.key === "staff_briefings") return sendStaffBriefings(ctx.admin);
      if (plan.key === "morning_briefing") return sendMorningBriefing(ctx.admin);
      return runVendorMatching(ctx.admin);
    },
  },
  {
    name: "app_invites_revoke",
    description: "Revoke a pending couple-app invite. Accepted invites are left alone.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, invite_id: UUID }, ["event_id", "invite_id"]),
    async execute(args, ctx) {
      return revokeAppInvite(db(ctx), s(args, "event_id")!, s(args, "invite_id")!);
    },
  },
  {
    name: "events_release_held_sends",
    description: "Release held onboarding messages after their rendered bodies still match. The cron cannot claim held rows.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async authorize(args, ctx) {
      const eventId = s(args, "event_id")!;
      const [email, sms] = await Promise.all([rows(ctx.admin, "email_log", eventId), rows(ctx.admin, "sms_log", eventId)]);
      if (email.some((row) => row.status === "held") && !ctx.token.scopes.includes("comms.email")) throw new McpScopeError("Releasing held email needs comms.email.");
      if (sms.some((row) => row.status === "held") && !ctx.token.scopes.includes("comms.sms")) throw new McpScopeError("Releasing held texts needs comms.sms.");
    },
    async freeze(args, ctx) {
      const eventId = s(args, "event_id")!;
      const [email, sms, helpers] = await Promise.all([
        rows(ctx.admin, "email_log", eventId),
        rows(ctx.admin, "sms_log", eventId),
        ctx.admin.from("booking_helpers").select("id, webhook_url").eq("is_active", true).eq("auto_on_create", true),
      ]);
      if (helpers.error) throw new Error(helpers.error.message);
      const plan = heldDeliveryPlan([
        ...email.map((row) => ({ id: row.id, channel: "email" as const, to: row.to_address ?? "", body: row.body_html ?? "", status: row.status })),
        ...sms.map((row) => ({ id: row.id, channel: "sms" as const, to: row.to_number ?? "", body: row.body ?? "", status: row.status })),
      ]);
      return { ...plan, webhooks: (helpers.data ?? []).map((row) => ({ helper_id: (row as { id: string }).id, webhook_url: (row as { webhook_url: string | null }).webhook_url })) };
    },
    async preview(args, ctx) {
      return parityTools.find((tool) => tool.name === "events_release_held_sends")!.freeze!(args, ctx);
    },
    async execute(args, ctx) {
      const eventId = s(args, "event_id")!;
      const snap = ctx.approvedSnapshot as { messages?: { id: string; body_sha256: string; channel: string }[]; webhooks?: { helper_id: string; webhook_url: string | null }[] } | null;
      if (!snap?.messages) throw new Error("The held-send approval is missing. Nothing was released.");
      const [email, sms] = await Promise.all([rows(ctx.admin, "email_log", eventId), rows(ctx.admin, "sms_log", eventId)]);
      const current = [
        ...email.map((row) => ({ id: row.id, body: row.body_html ?? "", status: row.status, channel: "email" })),
        ...sms.map((row) => ({ id: row.id, body: row.body ?? "", status: row.status, channel: "sms" })),
      ];
      const released = releaseHeld({ messages: snap.messages ?? [] }, current.filter((row) => (snap.messages ?? []).some((message) => message.id === row.id)));
      const emailIds = released.ids.filter((id) => current.find((row) => row.id === id)?.channel === "email");
      const smsIds = released.ids.filter((id) => current.find((row) => row.id === id)?.channel === "sms");
      if (emailIds.length) {
        const { error } = await ctx.admin.from("email_log").update({ status: "sending" }).in("id", emailIds).eq("status", "held");
        if (error) throw new Error(error.message);
        await processOutbox(ctx.admin, { onlyIds: emailIds, fromStatus: "sending" });
      }
      if (smsIds.length) {
        const { error } = await ctx.admin.from("sms_log").update({ status: "sending" }).in("id", smsIds).eq("status", "held");
        if (error) throw new Error(error.message);
        await processSmsOutbox(ctx.admin, { onlyIds: smsIds, fromStatus: "sending" });
      }
      for (const hook of snap.webhooks ?? []) {
        if (hook.webhook_url) await fireHelperWebhook(ctx.admin, hook.helper_id, eventId);
      }
      return { ok: true, released: released.ids.length };
    },
  },
];

for (const tool of parityTools) tool.writes = true;
