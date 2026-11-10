import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postApprovedWebhook } from "@/lib/automations";
import { processSmsOutbox } from "@/lib/highlevel";
import { processOutbox } from "@/lib/mailgun";
import {
  acceptEventUpload,
  sniffUpload,
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
  markEventEquipment,
  saveDailyStatusAction,
  saveDocumentOperation,
  saveEventAddonWording,
  saveEventNote,
  saveEventRecord,
  saveStaffLog,
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
import { bindMessages, messagesMatch, sameIdSet } from "@/lib/jobApproval";
import { previewMorningDigest } from "@/lib/morningBriefing";
import { previewStaffBriefings } from "@/lib/staffBriefing";
import { sendBrandedEmail } from "@/lib/mailgun";
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
      let sha = planned.sha256;
      let size = planned.bytes?.length ?? 0;
      if (planned.bytes) {
        const { error } = await admin.storage.from("event-files").upload(planned.path, planned.bytes, { contentType: planned.contentType, upsert: false });
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await admin.storage.from("event-files").download(planned.path);
        if (error || !data) throw new Error(error?.message ?? "That staged file is not in event storage.");
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.length === 0 || bytes.length > 192_000) throw new Error("Staged file must be between 1 byte and 192 KB.");
        const sniffed = sniffUpload(bytes);
        if (!sniffed || sniffed !== planned.contentType) throw new Error("The staged file contents do not match the declared type.");
        sha = createHash("sha256").update(bytes).digest("hex");
        size = bytes.length;
      }
      await saveEventFileRow(db(ctx), { event_id: eventId, name: planned.filename, path: planned.path, content_type: planned.contentType, size_bytes: size, sha256: sha, source: planned.bytes ? "agent" : "staged", label_id: s(args, "label_id") });
      return { ok: true, path: planned.path, sha256: sha };
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
    description: "Launch one approved job. Staff and morning mail are sent only when the rendered recipient list still matches. Vendor matching writes suggestions for the approved rows and does not send mail.",
    scopes: [],
    confirm: true,
    inputSchema: obj({ key: { type: "string", enum: ["staff_briefings", "morning_briefing", "vendor_matching"] } }, ["key"]),
    async authorize(args, ctx) {
      const plan = planJobLaunch(s(args, "key")!);
      const need = plan.sends ? "comms.email" : "write.settings";
      if (!ctx.token.scopes.includes(need)) throw new McpScopeError(`This job needs ${need}.`);
    },
    async freeze(args, ctx) {
      const plan = planJobLaunch(s(args, "key")!);
      if (plan.key === "staff_briefings") {
        const messages = await previewStaffBriefings(ctx.admin);
        return { ...plan, messages: bindMessages(messages) };
      }
      if (plan.key === "morning_briefing") {
        const message = await previewMorningDigest(ctx.admin);
        return { ...plan, messages: bindMessages([message]) };
      }
      const { data, error } = await ctx.admin.from("event_vendors").select("id").is("match_checked_at", null).limit(50);
      if (error) throw new Error(error.message);
      return { ...plan, vendor_ids: ((data ?? []) as { id: string }[]).map((row) => row.id) };
    },
    async preview(args, ctx) {
      return parityTools.find((tool) => tool.name === "jobs_launch")!.freeze!(args, ctx);
    },
    async execute(args, ctx) {
      const snap = ctx.approvedSnapshot as { messages?: { to: string; body_sha256: string }[]; vendor_ids?: string[]; key?: string } | null;
      const plan = planJobLaunch(s(args, "key")!);
      if (plan.key === "vendor_matching") {
        if (!snap?.vendor_ids) throw new Error("The vendor-matching approval is missing. Nothing was changed.");
        const { data, error } = await ctx.admin.from("event_vendors").select("id").is("match_checked_at", null).limit(50);
        if (error) throw new Error(error.message);
        sameIdSet(snap.vendor_ids, ((data ?? []) as { id: string }[]).map((row) => row.id));
        return runVendorMatching(ctx.admin, 50, snap.vendor_ids);
      }
      if (!snap?.messages) throw new Error("The job approval is missing. Nothing was sent.");
      const fresh = plan.key === "staff_briefings" ? await previewStaffBriefings(ctx.admin) : [await previewMorningDigest(ctx.admin)];
      const approved = messagesMatch(snap.messages, fresh);
      for (const message of approved) {
        const sent = await sendBrandedEmail({ to: message.to, subject: message.subject, contentHtml: message.body, supabase: ctx.admin });
        if (!sent.ok) throw new Error(sent.error ?? "The approved message was not sent.");
        if (plan.key === "staff_briefings") {
          const person = fresh.find((item) => "employeeId" in item && item.to === message.to) as { employeeId?: string } | undefined;
          if (person?.employeeId) {
            const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
            const { error } = await ctx.admin.from("staff_briefing_prefs").update({ last_sent_on: today }).eq("employee_id", person.employeeId);
            if (error) throw new Error(error.message);
          }
        }
      }
      return { ok: true, sent: approved.length };
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
    description: "Release the exact held email, text, staff notification, and webhook rows after their bodies still match. The cron cannot claim held rows.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID }, ["event_id"]),
    async authorize(args, ctx) {
      const eventId = s(args, "event_id")!;
      const [email, sms] = await Promise.all([rows(ctx.admin, "email_log", eventId), rows(ctx.admin, "sms_log", eventId)]);
      if (email.some((row) => row.status === "held") && !ctx.token.scopes.includes("comms.email")) throw new McpScopeError("Releasing held email needs comms.email.");
      if (sms.some((row) => row.status === "held") && !ctx.token.scopes.includes("comms.sms")) throw new McpScopeError("Releasing held texts needs comms.sms.");
      const effects = await ctx.admin.from("mcp_held_effects").select("kind").eq("event_id", eventId).eq("status", "held");
      if (effects.error) throw new Error(effects.error.message);
      if ((effects.data ?? []).some((row) => (row as { kind?: string }).kind === "webhook") && !ctx.token.scopes.includes("comms.webhook")) {
        throw new McpScopeError("Releasing a held webhook needs comms.webhook.");
      }
    },
    async freeze(args, ctx) {
      const eventId = s(args, "event_id")!;
      const [email, sms, effects] = await Promise.all([
        rows(ctx.admin, "email_log", eventId),
        rows(ctx.admin, "sms_log", eventId),
        ctx.admin.from("mcp_held_effects").select("id, kind, payload, payload_sha, status").eq("event_id", eventId).in("status", ["held", "queued"]),
      ]);
      if (effects.error) throw new Error(effects.error.message);
      const plan = heldDeliveryPlan([
        ...email.map((row) => ({ id: row.id, channel: "email" as const, to: row.to_address ?? "", body: row.body_html ?? "", status: row.status })),
        ...sms.map((row) => ({ id: row.id, channel: "sms" as const, to: row.to_number ?? "", body: row.body ?? "", status: row.status })),
        ...((effects.data ?? []) as { id: string; kind: string; payload: unknown; payload_sha?: string | null; status: string }[]).map((row) => ({ id: row.id, channel: "email" as const, to: row.kind, body: JSON.stringify(row.payload), bodySha: row.payload_sha ?? undefined, status: row.status })),
      ]);
      return {
        ...plan,
        email_ids: email.filter((row) => row.status === "held").map((row) => row.id),
        sms_ids: sms.filter((row) => row.status === "held").map((row) => row.id),
        effect_ids: ((effects.data ?? []) as { id: string; status: string }[]).filter((row) => row.status === "held").map((row) => row.id),
      };
    },
    async preview(args, ctx) {
      return parityTools.find((tool) => tool.name === "events_release_held_sends")!.freeze!(args, ctx);
    },
    async execute(args, ctx) {
      const eventId = s(args, "event_id")!;
      const snap = ctx.approvedSnapshot as { messages?: { id: string; body_sha256: string }[]; email_ids?: string[]; sms_ids?: string[]; effect_ids?: string[] } | null;
      if (!snap?.messages || !snap.email_ids || !snap.sms_ids || !snap.effect_ids) throw new Error("The held-send approval is missing. Nothing was released.");
      const [email, sms, effects] = await Promise.all([
        rows(ctx.admin, "email_log", eventId),
        rows(ctx.admin, "sms_log", eventId),
        ctx.admin.from("mcp_held_effects").select("id, kind, payload, payload_sha, status").eq("event_id", eventId).in("status", ["held"]),
      ]);
      if (effects.error) throw new Error(effects.error.message);
      const effectRows = (effects.data ?? []) as { id: string; kind: string; payload: { webhook_url?: string; trigger?: string; event_id?: string; helper_id?: string; employeeId?: string; title?: string; body?: string | null; href?: string | null; typeKey?: string }; payload_sha?: string | null; status: string }[];
      const current = [
        ...email.map((row) => ({ id: row.id, body: row.body_html ?? "", status: row.status })),
        ...sms.map((row) => ({ id: row.id, body: row.body ?? "", status: row.status })),
        ...effectRows.map((row) => ({ id: row.id, body: JSON.stringify(row.payload), bodySha: row.payload_sha ?? undefined, status: row.status })),
      ];
      releaseHeld({ messages: snap.messages }, current.filter((row) => snap.messages!.some((message) => message.id === row.id)));
      const shaFor = (ids: string[]) => ids.map((id) => snap.messages!.find((message) => message.id === id)?.body_sha256 ?? "");
      const { error: claimError } = await ctx.admin.rpc("mcp_claim_held", {
        p_email: snap.email_ids,
        p_sms: snap.sms_ids,
        p_effects: snap.effect_ids,
        p_email_sha: shaFor(snap.email_ids),
        p_sms_sha: shaFor(snap.sms_ids),
        p_effect_sha: shaFor(snap.effect_ids),
      });
      if (claimError) throw new Error(claimError.message.includes("held rows changed") ? "The held rows changed. Nothing was released." : claimError.message);
      if (snap.email_ids.length) {
        const drained = await processOutbox(ctx.admin, { onlyIds: snap.email_ids, fromStatus: "sending" });
        if (drained.error || drained.failed) throw new Error(drained.error ?? "A held email was not sent. It was not marked released.");
      }
      if (snap.sms_ids.length) {
        const drained = await processSmsOutbox(ctx.admin, { onlyIds: snap.sms_ids, fromStatus: "sending" });
        if (drained.error || drained.failed) throw new Error(drained.error ?? "A held text was not sent. It was not marked released.");
      }
      const pushIds = effectRows.filter((row) => snap.effect_ids!.includes(row.id) && row.kind === "push").map((row) => row.id);
      if (pushIds.length) {
        const { error } = await ctx.admin.from("mcp_held_effects").update({ status: "blocked" }).in("id", pushIds).eq("status", "sending");
        if (error) throw new Error(error.message);
        throw new Error("Held push notifications were not delivered and were not marked released.");
      }
      for (const effect of effectRows.filter((row) => snap.effect_ids!.includes(row.id) && row.kind !== "push")) {
        if (effect.kind === "webhook" && effect.payload.webhook_url) {
          const { webhook_url: webhookUrl, ...rest } = effect.payload;
          await postApprovedWebhook(webhookUrl, rest);
        }
        if (effect.kind === "bell") {
          const { error } = await ctx.admin.rpc("create_targeted_notification", {
            p_type: effect.payload.typeKey ?? "event_created",
            p_title: effect.payload.title ?? "Update",
            p_body: effect.payload.body ?? null,
            p_href: effect.payload.href ?? null,
            p_target_employee: effect.payload.employeeId,
            p_target_roles: [],
          });
          if (error) throw new Error(error.message);
        }
      }
      const delivered = effectRows.filter((row) => snap.effect_ids!.includes(row.id) && row.kind !== "push").map((row) => row.id);
      if (delivered.length) {
        const { error } = await ctx.admin.from("mcp_held_effects").update({ status: "released" }).in("id", delivered).eq("status", "sending");
        if (error) throw new Error(error.message);
      }
      return { ok: true, released: snap.email_ids.length + snap.sms_ids.length + snap.effect_ids.length };
    },
  },
  {
    name: "events_record",
    description: "Update one event section: details, venue, links, booking, dates, billing terms, schedule acknowledgement, or package wording.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, section: { type: "string", enum: ["details", "venue", "links", "booking", "dates", "billing", "acknowledge", "package_wording"] }, fields_json: STR }, ["event_id", "section", "fields_json"]),
    async authorize(args, ctx) {
      const fields = JSON.parse(s(args, "fields_json") || "{}") as Record<string, unknown>;
      const section = s(args, "section");
      if ((section === "billing" || section === "acknowledge") && !ctx.token.scopes.includes("money")) {
        throw new McpScopeError("Billing and schedule acknowledgement need money.");
      }
      if (section === "booking" && fields.status_id && !ctx.token.scopes.includes("comms.email") && !ctx.token.scopes.includes("comms.sms")) {
        throw new McpScopeError("Changing status can send mail or texts and needs a comms scope.");
      }
    },
    async execute(args, ctx) {
      const fields = JSON.parse(s(args, "fields_json") || "{}") as Record<string, unknown>;
      const saved = await saveEventRecord(db(ctx), s(args, "event_id")!, s(args, "section")!, fields);
      if (s(args, "section") === "booking" && (saved as { status_changed?: boolean }).status_changed) {
        const { runAutomations } = await import("@/lib/automations");
        await runAutomations(ctx.admin, s(args, "event_id")!, "status_changed", { statusId: String(fields.status_id), drain: "hold" });
      }
      return saved;
    },
  },
  {
    name: "events_notes",
    description: "Add a logistics note, a Booking Agreement note, or a client note, or update an existing event note.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, kind: { type: "string", enum: ["logistics", "contract", "client", "update"] }, body: STR, note_id: UUID, client_id: UUID }, ["event_id", "kind", "body"]),
    async authorize(args, ctx) {
      if (s(args, "kind") === "client" && !ctx.token.scopes.includes("write.clients")) throw new McpScopeError("A client note needs write.clients.");
    },
    async execute(args, ctx) {
      const members = await ctx.admin.from("event_clients").select("client_id").eq("event_id", s(args, "event_id"));
      if (members.error) throw new Error(members.error.message);
      return saveEventNote(db(ctx), s(args, "event_id")!, {
        kind: s(args, "kind")!,
        body: s(args, "body") ?? undefined,
        noteId: s(args, "note_id"),
        clientId: s(args, "client_id"),
        memberIds: ((members.data ?? []) as { client_id: string }[]).map((row) => row.client_id),
      });
    },
  },
  {
    name: "events_staff_log",
    description: "Stamp staff notified, confirmed, or checked in, edit their assignment, or set portal visibility. A wage requires payroll scope.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, staff_id: UUID, action: { type: "string", enum: ["mark", "details", "portal"] }, field: STR, role: STR, flat_wage: { type: "number" }, start_time: STR, end_time: STR, notes: STR, portal_visible: { type: "boolean" } }, ["event_id", "staff_id", "action"]),
    async authorize(args, ctx) {
      if (s(args, "action") === "details" && "flat_wage" in args && !ctx.token.scopes.includes("money.payroll")) {
        throw new McpScopeError("Saving a wage needs money.payroll.");
      }
    },
    async execute(args, ctx) {
      return saveStaffLog(db(ctx), s(args, "event_id")!, s(args, "staff_id")!, {
        action: s(args, "action")!,
        field: s(args, "field") ?? undefined,
        role: s(args, "role") ?? undefined,
        flatWage: typeof args.flat_wage === "number" ? args.flat_wage : undefined,
        startTime: s(args, "start_time"),
        endTime: s(args, "end_time"),
        notes: s(args, "notes"),
        portalVisible: args.portal_visible === true,
      });
    },
  },
  {
    name: "events_equipment_mark",
    description: "Stamp event equipment checked out or checked back in.",
    scopes: ["write.events"],
    confirm: false,
    inputSchema: obj({ event_id: UUID, row_id: UUID, field: { type: "string", enum: ["checked_out_at", "checked_in_at"] } }, ["event_id", "row_id", "field"]),
    async execute(args, ctx) {
      return markEventEquipment(db(ctx), s(args, "event_id")!, s(args, "row_id")!, s(args, "field")!);
    },
  },
  {
    name: "events_addon_wording",
    description: "Change the quantity, price override, and wording of an add-on already on an event.",
    scopes: ["write.events"],
    confirm: true,
    inputSchema: obj({ event_id: UUID, event_addon_id: UUID, quantity: { type: "integer" }, price: { type: "number" }, base_price: { type: "number" }, description: STR, base_description: STR }, ["event_id", "event_addon_id"]),
    async authorize(args, ctx) {
      if ("price" in args && !ctx.token.scopes.includes("money")) throw new McpScopeError("Changing an add-on price needs money.");
    },
    async execute(args, ctx) {
      return saveEventAddonWording(db(ctx), s(args, "event_id")!, s(args, "event_addon_id")!, {
        quantity: typeof args.quantity === "number" ? args.quantity : 1,
        price: typeof args.price === "number" ? args.price : undefined,
        basePrice: typeof args.base_price === "number" ? args.base_price : undefined,
        description: s(args, "description") ?? undefined,
        baseDescription: s(args, "base_description") ?? undefined,
      });
    },
  },
  {
    name: "documents_manage",
    description: "Archive or copy a document template, or change visibility, blocks, or delete an unsigned generated document.",
    scopes: ["write.documents"],
    confirm: true,
    inputSchema: obj({ action: { type: "string", enum: ["archive_template", "duplicate_template", "visibility", "delete", "blocks"] }, template_id: UUID, document_id: UUID, visible: { type: "boolean" }, blocks_json: STR }, ["action"]),
    async authorize(args, ctx) {
      if (s(args, "action") === "delete" && !ctx.token.scopes.includes("delete")) throw new McpScopeError("Deleting a document needs delete.");
    },
    async execute(args, ctx) {
      return saveDocumentOperation(db(ctx), {
        action: s(args, "action")!,
        templateId: s(args, "template_id"),
        documentId: s(args, "document_id"),
        visible: args.visible === true,
        blocks: s(args, "blocks_json") ? JSON.parse(s(args, "blocks_json")!) : undefined,
      });
    },
  },
];

for (const tool of parityTools) tool.writes = true;
