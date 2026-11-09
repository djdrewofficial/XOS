/** Office writes that the staff forms and the agent tools share.
    Every database result is checked. A ignored error is not a success. */

import { createHash } from "node:crypto";
import type { EditorDb } from "./officeEdits";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
]);
const MAX_UPLOAD_BYTES = 192_000;

async function must(query: PromiseLike<Result>, label: string): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

function id(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!UUID.test(text)) throw new Error(`${label} is not a valid id.`);
  return text;
}

function nameOf(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

export function acceptEventUpload(input: { eventId: string; filename: string; contentType: string; contentBase64?: string | null; stagedPath?: string | null }): { filename: string; contentType: string; bytes: Buffer | null; path: string } {
  const eventId = id(input.eventId, "Event");
  const filename = nameOf(input.filename, "File name").replace(/[^\w.\- ]+/g, "").slice(0, 120);
  if (!filename || filename.includes("..")) throw new Error("File name is not allowed.");
  const contentType = String(input.contentType ?? "").toLowerCase();
  if (!MIME.has(contentType)) throw new Error("That file type is not allowed.");
  const ext = filename.split(".").pop()?.toLowerCase() || "bin";
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("File extension is not allowed.");
  if (input.contentBase64 && input.stagedPath) throw new Error("Send the file bytes or a staged path, not both.");
  if (input.stagedPath) {
    const path = String(input.stagedPath);
    if (path.includes("://") || path.includes("..") || !path.startsWith(`${eventId}/`)) throw new Error("Staged files must already live under this event.");
    if (!new RegExp(`^${eventId}/[0-9a-f-]{36}\\.${ext}$`, "i").test(path)) throw new Error("Staged path is not an event file path.");
    return { filename, contentType, bytes: null, path };
  }
  const raw = String(input.contentBase64 ?? "");
  if (!raw) throw new Error("Choose a file first.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) throw new Error("File must be between 1 byte and 192 KB for an agent upload.");
  return { filename, contentType, bytes, path: `${eventId}/${crypto.randomUUID()}.${ext}` };
}

export async function saveEventFileRow(db: EditorDb, row: Row) {
  await must(db.from("event_files").insert(row), "Saving the file");
  return { ok: true, path: row.path };
}

export async function setEventFileLabel(db: EditorDb, eventId: string, fileId: string, labelId: string | null) {
  await must(db.from("event_files").update({ label_id: labelId }).eq("id", id(fileId, "File")).eq("event_id", id(eventId, "Event")), "Setting the file label");
  return { ok: true };
}

export async function deleteEventFileRow(db: EditorDb, eventId: string, fileId: string) {
  const rows = await must(db.from("event_files").select("path").eq("id", id(fileId, "File")).eq("event_id", id(eventId, "Event")), "Loading the file");
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  if (!list.length) throw new Error("That file is not on this event.");
  await must(db.from("event_files").delete().eq("id", fileId).eq("event_id", eventId), "Deleting the file");
  return { ok: true, path: (list[0] as Row).path };
}

export async function saveFileLabel(db: EditorDb, input: { name: string; sortOrder?: number }) {
  const name = nameOf(input.name, "Label");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) throw new Error("Label needs at least one letter or number.");
  await must(db.from("file_label_definitions").insert({ name, slug, sort_order: input.sortOrder ?? 0 }), "Saving the label");
  await must(db.from("merge_tags").insert({ tag_key: `document_${slug}`, label: `Attach: ${name} files`, group_name: "Files", is_builtin: true, source_type: "attachment", is_active: true }), "Saving the label tag");
  return { slug };
}

export async function saveEquipmentFlags(db: EditorDb, eventId: string, rowId: string, patch: { packed?: boolean; notes?: string | null }) {
  const next: Row = {};
  if (patch.packed !== undefined) next.packed = patch.packed === true;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (!Object.keys(next).length) throw new Error("Nothing to update.");
  await must(db.from("event_equipment").update(next).eq("id", id(rowId, "Equipment")).eq("event_id", id(eventId, "Event")), "Updating equipment");
  return next;
}

export async function saveTimeOff(db: EditorDb, employeeId: string, input: { startDate: string; endDate?: string | null; status?: string; notes?: string | null }) {
  const status = input.status ?? "approved";
  if (!["pending", "approved", "denied"].includes(status)) throw new Error("Time off status must be pending, approved, or denied.");
  const start = nameOf(input.startDate, "Start date");
  await must(db.from("employee_time_off").insert({
    employee_id: id(employeeId, "Employee"),
    start_date: start,
    end_date: input.endDate || start,
    status,
    notes: input.notes ?? null,
  }), "Saving time off");
  return { status, notifies: status === "pending" };
}

export async function setTimeOffStatus(db: EditorDb, employeeId: string, timeOffId: string, status: string) {
  if (!["pending", "approved", "denied"].includes(status)) throw new Error("Time off status must be pending, approved, or denied.");
  await must(db.from("employee_time_off").update({ status }).eq("id", id(timeOffId, "Time off")).eq("employee_id", id(employeeId, "Employee")), "Updating time off");
  return { status };
}

export async function deleteTimeOff(db: EditorDb, employeeId: string, timeOffId: string) {
  await must(db.from("employee_time_off").delete().eq("id", id(timeOffId, "Time off")).eq("employee_id", id(employeeId, "Employee")), "Deleting time off");
  return { ok: true };
}

async function saveCategory(db: EditorDb, table: string, input: { id?: string | null; name?: string; isActive?: boolean; delete?: boolean }) {
  if (input.delete) {
    await must(db.from(table).delete().eq("id", id(input.id, "Category")), "Deleting the category");
    return { ok: true };
  }
  const name = nameOf(input.name, "Name");
  if (input.id) {
    await must(db.from(table).update({ name, is_active: input.isActive !== false }).eq("id", id(input.id, "Category")), "Updating the category");
    return { name };
  }
  await must(db.from(table).insert({ name }), "Saving the category");
  return { name };
}

type CategoryInput = { id?: string | null; name?: string; isActive?: boolean; delete?: boolean };
export const savePackageCategory = (db: EditorDb, input: CategoryInput) => saveCategory(db, "package_categories", input);
export const saveAddonCategory = (db: EditorDb, input: CategoryInput) => saveCategory(db, "addon_categories", input);
export const saveVenueCategory = (db: EditorDb, input: CategoryInput) => saveCategory(db, "venue_categories", input);

export async function categoryIsEmpty(db: EditorDb, table: string, column: string, categoryId: string) {
  const rows = await must(db.from(table).select("id").eq(column, id(categoryId, "Category")), "Checking the category");
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > 0) throw new Error("That category is still in use.");
}

export async function saveAddonEquipmentDefaults(db: EditorDb, addonId: string, rows: { itemId?: string | null; systemId?: string | null; quantity: number }[]) {
  const addon = id(addonId, "Add-on");
  await must(db.from("addon_equipment_defaults").delete().eq("addon_id", addon), "Clearing add-on equipment");
  const clean = rows.filter((row) => row.quantity > 0).map((row) => ({
    addon_id: addon,
    item_id: row.itemId ?? null,
    system_id: row.systemId ?? null,
    quantity: Math.round(row.quantity),
  }));
  if (clean.length) await must(db.from("addon_equipment_defaults").insert(clean), "Saving add-on equipment");
  return { count: clean.length };
}

export async function saveVenueRoom(db: EditorDb, venueId: string, name: string) {
  await must(db.from("venue_rooms").insert({ venue_id: id(venueId, "Venue"), name: nameOf(name, "Room") }), "Saving the room");
  return { ok: true };
}

export function reminderRule(input: { when: string; days?: number; sendEmail?: boolean; sendSms?: boolean; emailTemplateId?: string | null; smsTemplateId?: string | null; isActive?: boolean }) {
  const when = input.when;
  if (!["before", "on", "after"].includes(when)) throw new Error("Reminder timing must be before, on, or after.");
  const mag = Math.abs(Math.trunc(Number(input.days ?? 0)));
  if (!Number.isFinite(mag)) throw new Error("Reminder days must be a number.");
  const offset = when === "before" ? -mag : when === "after" ? mag : 0;
  return {
    offset_days: offset,
    label: offset < 0 ? `${-offset} days before due` : offset > 0 ? `${offset} days past due` : "On the due date",
    send_email: input.sendEmail === true,
    send_sms: input.sendSms === true,
    email_template_id: input.emailTemplateId ?? null,
    sms_template_id: input.smsTemplateId ?? null,
    is_active: input.isActive !== false,
  };
}

export async function saveReminderRule(db: EditorDb, ruleId: string | null, input: Parameters<typeof reminderRule>[0]) {
  const row = reminderRule(input);
  if (ruleId) await must(db.from("payment_reminder_rules").update(row).eq("id", id(ruleId, "Rule")), "Updating the reminder");
  else await must(db.from("payment_reminder_rules").insert(row), "Saving the reminder");
  return row;
}

export function customTagKey(value: string): string {
  const key = value.trim().replace(/^<|>$/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) throw new Error("Tag key is required.");
  return key;
}

export async function saveCustomTag(db: EditorDb, input: { id?: string | null; tagKey?: string; label?: string; sourceType?: string; sourceValue?: string | null; delete?: boolean }) {
  if (input.delete) {
    await must(db.from("merge_tags").delete().eq("id", id(input.id, "Tag")).eq("is_builtin", false), "Deleting the tag");
    return { ok: true };
  }
  if (input.id) {
    await must(db.from("merge_tags").update({
      label: nameOf(input.label, "Label"),
      source_type: input.sourceType ?? "static",
      source_value: input.sourceValue ?? null,
    }).eq("id", id(input.id, "Tag")).eq("is_builtin", false), "Updating the tag");
    return { ok: true };
  }
  const tag_key = customTagKey(input.tagKey ?? "");
  await must(db.from("merge_tags").insert({ tag_key, label: input.label || tag_key, group_name: "CUSTOM", source_type: input.sourceType ?? "static", source_value: input.sourceValue ?? null, is_builtin: false, is_active: true }), "Saving the tag");
  return { tag_key };
}

export async function saveMileageSettings(db: EditorDb, input: { enabled?: boolean; rate?: number; roundTrip?: boolean; categoryId?: string | null }) {
  const rate = Number(input.rate ?? 0.7);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Mileage rate must be a positive number or zero.");
  await must(db.from("expense_settings").update({
    auto_mileage_enabled: input.enabled === true,
    mileage_rate: rate,
    mileage_round_trip: input.roundTrip === true,
    mileage_category_id: input.categoryId ?? null,
  }).eq("id", true), "Saving mileage settings");
  return { rate };
}

export async function saveDailyStatusAction(db: EditorDb, input: { id?: string | null; trigger?: string; fromStatusId?: string; toStatusId?: string; isActive?: boolean; delete?: boolean }) {
  if (input.delete) {
    await must(db.from("daily_status_actions").delete().eq("id", id(input.id, "Action")), "Deleting the daily action");
    return { ok: true };
  }
  const trigger = input.trigger ?? "event_date_passed";
  if (!["event_date_passed", "contract_due_passed"].includes(trigger)) throw new Error("Daily action trigger is not recognized.");
  const row = { trigger_type: trigger, from_status_id: id(input.fromStatusId, "From status"), to_status_id: id(input.toStatusId, "To status"), is_active: input.isActive !== false };
  if (input.id) await must(db.from("daily_status_actions").update(row).eq("id", id(input.id, "Action")), "Updating the daily action");
  else await must(db.from("daily_status_actions").insert(row), "Saving the daily action");
  return row;
}

export async function saveEmailSignature(db: EditorDb, html: string) {
  const body = String(html ?? "").trim();
  if (!body) throw new Error("Signature is required.");
  if (/<script|javascript:/i.test(body)) throw new Error("Signature cannot contain a script.");
  await must(db.from("company_settings").update({ email_signature_html: body }).eq("id", true), "Saving the signature");
  return { ok: true };
}

export async function saveBlackout(db: EditorDb, input: { id?: string | null; day?: string; label?: string | null; delete?: boolean }) {
  if (input.delete) {
    await must(db.from("email_blackout_dates").delete().eq("id", id(input.id, "Blackout")), "Deleting the blackout");
    return { ok: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.day ?? ""))) throw new Error("Blackout day must be YYYY-MM-DD.");
  await must(db.from("email_blackout_dates").insert({ day: input.day, label: input.label ?? null }), "Saving the blackout");
  return { day: input.day };
}

export async function saveModerationStatus(db: EditorDb, eventId: string, reportId: string, status: string) {
  if (status !== "resolved" && status !== "dismissed") throw new Error("Report status must be resolved or dismissed.");
  await must(db.from("event_content_reports").update({ status, resolved_at: new Date().toISOString() }).eq("id", id(reportId, "Report")).eq("event_id", id(eventId, "Event")), "Updating the report");
  return { status };
}

export async function saveBriefingGlobal(db: EditorDb, input: { enabled?: boolean; hour?: number }) {
  const hour = input.hour == null ? null : Math.trunc(Number(input.hour));
  if (hour != null && (hour < 0 || hour > 23)) throw new Error("Briefing hour must be from 0 to 23.");
  const patch: Row = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled === true;
  if (hour != null) patch.config = { hour };
  await must(db.from("ai_tasks").update(patch).eq("key", "staff_briefings"), "Saving the briefing");
  return patch;
}

export async function saveAiTask(db: EditorDb, key: string, input: { enabled?: boolean; hour?: number; recipients?: string | null }) {
  if (!["morning_briefing", "vendor_matching", "staff_briefings"].includes(key)) throw new Error("That AI task is not recognized.");
  const hour = Math.min(23, Math.max(0, Math.trunc(Number(input.hour ?? 7))));
  await must(db.from("ai_tasks").update({ enabled: input.enabled === true, config: { hour, recipients: input.recipients ?? null } }).eq("key", key), "Saving the AI task");
  return { key, hour };
}

export function planJobLaunch(key: string): { key: string; effect: string; sends: boolean } {
  if (key === "staff_briefings") return { key, effect: "Sends today's staff briefing to employees whose briefing preference is enabled.", sends: true };
  if (key === "morning_briefing") return { key, effect: "Sends the company morning briefing to the configured recipients.", sends: true };
  if (key === "vendor_matching") return { key, effect: "Runs vendor matching and stores suggestions. It does not email the client.", sends: false };
  throw new Error("That job cannot be launched.");
}

export async function revokeAppInvite(db: EditorDb, eventId: string, inviteId: string) {
  const rows = await must(db.from("event_app_invites").select("id, status").eq("id", id(inviteId, "Invite")).eq("event_id", id(eventId, "Event")), "Loading the invite");
  const list = Array.isArray(rows) ? rows as Row[] : [];
  const row = list[0];
  if (!row) throw new Error("That invite was not found.");
  if (row.status !== "pending") throw new Error("Only a pending invite can be revoked.");
  await must(db.from("event_app_invites").update({ status: "revoked" }).eq("id", inviteId).eq("event_id", eventId).eq("status", "pending"), "Revoking the invite");
  return { ok: true };
}

export function heldDeliveryPlan(rows: { id: string; channel: "email" | "sms"; to: string; body: string; status: string }[]) {
  const held = rows.filter((row) => row.status === "held");
  const escaped = rows.filter((row) => row.status === "queued");
  if (escaped.length) throw new Error("A queued message is outside the approval hold. Nothing was released.");
  return {
    pending: true,
    delivery: "A second approval is required before these messages are delivered. The outbox cron claims queued rows only, so held rows stay put.",
    messages: held.map((row) => ({ id: row.id, channel: row.channel, to: row.to, body_sha256: sha(row.body) })),
  };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function releaseHeld(plan: { messages: { id: string; body_sha256: string }[] }, current: { id: string; body: string; status: string }[]) {
  if (plan.messages.length !== current.length) throw new Error("The held messages changed. Nothing was released.");
  for (const message of plan.messages) {
    const row = current.find((item) => item.id === message.id);
    if (!row || row.status !== "held" || sha(row.body) !== message.body_sha256) throw new Error("The held messages changed. Nothing was released.");
  }
  return { ids: plan.messages.map((message) => message.id), nextStatus: "sending" as const };
}
