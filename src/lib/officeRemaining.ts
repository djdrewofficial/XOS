/** Remaining office operations. Identity and role fields are rejected here.
    SMS consent cannot invent an opt-in, and a STOP is not cleared as a side effect. */

import type { EditorDb } from "./officeEdits";
import { canRemoveCoupleMember } from "./eventAccess";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED_PROFILE = ["permission_tier", "auth_user_id", "role", "can_send_as_self", "is_master", "account_type"];
const HIDDEN_TARGETS = ["song", "song_like", "answer", "section_note", "do_not_play_note", "song_idea", "cover_photo", "booth_selection", "timeline_file"] as const;

async function must(query: PromiseLike<Result>, label: string): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

function uuid(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!UUID.test(text)) throw new Error(`${label} is not a valid id.`);
  return text;
}

function rejectEscalation(input: Record<string, unknown>) {
  for (const key of BLOCKED_PROFILE) {
    if (key in input && input[key] != null && input[key] !== "") {
      throw new Error(`${key} changes access and is not part of this profile edit.`);
    }
  }
}

export function employeeProfilePatch(section: string, input: Record<string, unknown>): Row {
  rejectEscalation(input);
  if (section === "general") {
    const first = String(input.first_name ?? "").trim();
    const last = String(input.last_name ?? "").trim();
    if (!first || !last) throw new Error("First and last name are required.");
    return {
      first_name: first,
      last_name: last,
      middle_name: input.middle_name ? String(input.middle_name) : null,
      stage_name: input.stage_name ? String(input.stage_name) : null,
      employment_type: input.employment_type ? String(input.employment_type) : null,
      staff_category: input.staff_category ? String(input.staff_category) : "Production",
      hired_date: input.hired_date ? String(input.hired_date) : null,
      profession_since: input.profession_since == null || input.profession_since === "" ? null : Number(input.profession_since),
      bio: input.bio ? String(input.bio) : null,
      notes: input.notes ? String(input.notes) : null,
      is_active: input.is_active !== false,
    };
  }
  if (section === "contact") {
    const email = input.email ? String(input.email).trim() : null;
    if (email && !email.includes("@")) throw new Error("Email must contain @.");
    return {
      email,
      phone: input.phone ? String(input.phone) : null,
      website: input.website ? String(input.website) : null,
      planning_meeting_url: input.planning_meeting_url ? String(input.planning_meeting_url) : null,
      address: input.address ? String(input.address) : null,
      emergency_contact: input.emergency_contact ? String(input.emergency_contact) : null,
      birthday: input.birthday ? String(input.birthday) : null,
    };
  }
  throw new Error("Profile section must be general or contact.");
}

export async function saveEmployeeProfile(db: EditorDb, employeeId: string, section: string, input: Record<string, unknown>) {
  const patch = employeeProfilePatch(section, input);
  await must(db.from("employees").update(patch).eq("id", uuid(employeeId, "Employee")), "Saving the employee");
  return patch;
}

export function employeePhotoPath(employeeId: string, filename: string, contentType: string): { path: string; contentType: string } {
  if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new Error("Staff photos must be PNG, JPEG, or WebP.");
  const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 80);
  if (!safe || safe.includes("..")) throw new Error("Photo name is not allowed.");
  return { path: `${uuid(employeeId, "Employee")}/${crypto.randomUUID()}-${safe}`, contentType };
}

export type SmsAction = "opt_out" | "clear_stop" | "grant_marketing" | "revoke_marketing";

export function decideSmsConsent(input: {
  action: string;
  evidence?: string | null;
  source?: string | null;
  statedAt?: string | null;
  currentlyStopped: boolean;
}): { action: SmsAction; evidence: string; source: "staff_record"; statedAt: string } {
  const action = input.action as SmsAction;
  if (!["opt_out", "clear_stop", "grant_marketing", "revoke_marketing"].includes(action)) {
    throw new Error("SMS action must be opt_out, clear_stop, grant_marketing, or revoke_marketing.");
  }
  const evidence = String(input.evidence ?? "").trim();
  if (evidence.length < 8) throw new Error("Record what the client said. A blank note is not consent.");
  if (input.source !== "staff_record") throw new Error("Consent source must be staff_record. An agent cannot invent another source.");
  const statedAt = String(input.statedAt ?? "").trim();
  if (!statedAt || Number.isNaN(Date.parse(statedAt))) throw new Error("Consent needs the time the client said it.");
  if ((action === "grant_marketing" || action === "clear_stop") && input.currentlyStopped && action === "grant_marketing") {
    throw new Error("This number is stopped. Marketing consent does not override STOP.");
  }
  if (action === "clear_stop" && !input.currentlyStopped) throw new Error("This number is not stopped.");
  return { action, evidence, source: "staff_record", statedAt };
}

export async function saveSmsConsent(
  db: EditorDb,
  clientId: string,
  input: { action: string; evidence?: string | null; source?: string | null; statedAt?: string | null },
  current: { phone: string | null; stopped: boolean },
) {
  const decision = decideSmsConsent({ ...input, currentlyStopped: current.stopped });
  if (!current.phone) throw new Error("No mobile number on file for this client.");
  if (decision.action === "opt_out" || decision.action === "clear_stop") {
    await must(db.from("sms_opt_outs").insert({
      phone: current.phone,
      opted_out: decision.action === "opt_out",
      source: "manual",
      reason: decision.evidence,
      signal_at: decision.statedAt,
    }), "Saving the STOP record");
    return { phone: current.phone, stopped: decision.action === "opt_out", marketing: null };
  }
  await must(db.from("clients").update({
    sms_opt_in: decision.action === "grant_marketing",
    sms_opt_in_at: decision.action === "grant_marketing" ? decision.statedAt : null,
    sms_opt_in_evidence: decision.evidence,
  }).eq("id", uuid(clientId, "Client")), "Saving marketing consent");
  return { phone: current.phone, stopped: current.stopped, marketing: decision.action === "grant_marketing", at: decision.statedAt };
}

const RESTORE_TABLE: Record<string, { table: string; clear: Row; idColumn: string; scopeColumn?: string }> = {
  song: { table: "planning_songs", clear: { hidden_at: null, hidden_by: null }, idColumn: "id", scopeColumn: "event_id" },
  answer: { table: "planning_question_answers", clear: { hidden_at: null, hidden_by: null }, idColumn: "question_id", scopeColumn: "event_id" },
  section_note: { table: "planning_sections", clear: { client_notes_hidden_at: null, client_notes_hidden_by: null }, idColumn: "id", scopeColumn: "event_id" },
  do_not_play_note: { table: "planning_do_not_play_notes", clear: { hidden_at: null, hidden_by: null }, idColumn: "event_id", scopeColumn: "event_id" },
  song_idea: { table: "song_ideas", clear: { hidden_at: null, hidden_by: null }, idColumn: "id", scopeColumn: "event_id" },
  cover_photo: { table: "events", clear: { cover_photo_hidden_at: null, cover_photo_hidden_by: null }, idColumn: "id" },
  booth_selection: { table: "event_photobooth_selection", clear: { hidden_at: null, hidden_by: null }, idColumn: "event_id", scopeColumn: "event_id" },
  timeline_file: { table: "event_files", clear: { hidden_at: null, hidden_by: null }, idColumn: "id", scopeColumn: "event_id" },
};

export async function restoreHidden(db: EditorDb, eventId: string, targetType: string, targetId: string, targetUserId?: string | null) {
  const event = uuid(eventId, "Event");
  if (!(HIDDEN_TARGETS as readonly string[]).includes(targetType)) throw new Error("That content type cannot be restored.");
  if (targetType === "song_like") {
    await must(db.from("planning_song_likes").update({ hidden_at: null, hidden_by: null }).eq("song_id", uuid(targetId, "Song")).eq("account_id", uuid(targetUserId, "Account")), "Restoring the like");
    return { ok: true };
  }
  const spec = RESTORE_TABLE[targetType];
  const rowId = targetType === "cover_photo" || targetType === "do_not_play_note" || targetType === "booth_selection" ? event : uuid(targetId, "Content");
  let query = db.from(spec.table).update(spec.clear).eq(spec.idColumn, rowId);
  if (spec.scopeColumn && targetType !== "cover_photo") query = query.eq(spec.scopeColumn, event);
  await must(query, "Restoring the content");
  return { ok: true };
}

export async function saveNamedRow(db: EditorDb, table: string, input: { id?: string | null; name?: string; isActive?: boolean; delete?: boolean }) {
  if (input.delete) {
    await must(db.from(table).delete().eq("id", uuid(input.id, "Row")), `Deleting from ${table}`);
    return { ok: true };
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name is required.");
  if (input.id) {
    await must(db.from(table).update({ name, is_active: input.isActive !== false }).eq("id", uuid(input.id, "Row")), `Updating ${table}`);
    return { name };
  }
  await must(db.from(table).insert({ name }), `Saving ${table}`);
  return { name };
}

export async function deleteReminderRule(db: EditorDb, ruleId: string) {
  await must(db.from("payment_reminder_rules").delete().eq("id", uuid(ruleId, "Rule")), "Deleting the reminder");
  return { ok: true };
}

export async function setArticleActive(db: EditorDb, articleId: string, active: boolean) {
  await must(db.from("kb_articles").update({ is_active: active }).eq("id", uuid(articleId, "Article")), "Updating the article");
  return { is_active: active };
}

export async function deleteArticle(db: EditorDb, articleId: string) {
  await must(db.from("kb_articles").delete().eq("id", uuid(articleId, "Article")), "Deleting the article");
  return { ok: true };
}

export function appInvitePlan(kind: string) {
  if (kind !== "resend" && kind !== "reset_link" && kind !== "email_code") throw new Error("Invite action must be resend, reset_link, or email_code.");
  return {
    kind,
    returns_secret: false,
    effect: kind === "email_code"
      ? "Emails the current join code to the contract holder. The code is not returned."
      : kind === "reset_link"
        ? "Replaces the join link. The new URL is not returned."
        : "Resends the pending invite. The link is not returned.",
  };
}

export function removeAppMemberDecision(member: { onEvent: boolean; isContractHolder: boolean; isPrimary: boolean; isAnchor: boolean }) {
  const decision = canRemoveCoupleMember(member);
  if (decision === "missing") throw new Error("That person is not on this event.");
  if (decision === "protected") throw new Error("The contract holder stays on the event.");
  return { ok: true as const };
}

export function signingFieldKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) throw new Error("Signing fields must be a list.");
  const allowed = ["event_date", "venue", "guest_count", "package", "client_name", "client_email", "client_phone"];
  const list = keys.map((key) => String(key));
  for (const key of list) if (!allowed.includes(key)) throw new Error(`Signing field ${key} is not recognized.`);
  return list;
}

export async function saveSigningFields(db: EditorDb, keys: unknown) {
  const required = signingFieldKeys(keys);
  await must(db.from("journey_settings").update({ required_signing_fields: required }).eq("id", true), "Saving signing requirements");
  return { required_signing_fields: required };
}

export function staffSettingsPatch(section: string, input: Record<string, unknown>): Row {
  rejectEscalation(input);
  if (section === "features") {
    return {
      feat_time_off: input.feat_time_off === true,
      feat_confirm_events: input.feat_confirm_events === true,
      feat_check_in_out: input.feat_check_in_out === true,
      time_off_mode: input.time_off_mode === "advance" ? "advance" : "any",
    };
  }
  if (section === "payroll") {
    return {
      payroll_sort_day: input.payroll_sort_day ? String(input.payroll_sort_day) : "event_type",
      payroll_name_format: input.payroll_name_format ? String(input.payroll_name_format) : "first_last",
    };
  }
  if (section === "notifications") {
    return { notify_time_off: input.notify_time_off ? String(input.notify_time_off) : null };
  }
  if (section === "sort") return { availability_sort: input.availability_sort === "name" ? "name" : "display_order" };
  throw new Error("Staff settings section is not recognized.");
}

export async function saveStaffSettings(db: EditorDb, section: string, input: Record<string, unknown>) {
  const patch = staffSettingsPatch(section, input);
  await must(db.from("staff_settings").update(patch).eq("id", true), "Saving staff settings");
  return patch;
}

export function paymentSettingsPatch(input: Record<string, unknown>): Row {
  const methods = Array.isArray(input.payment_methods) ? input.payment_methods.map(String) : [];
  if (methods.some((method) => method.length > 40)) throw new Error("A payment method name is too long.");
  const fee = Number(input.paypal_fee_pct ?? 0);
  if (!Number.isFinite(fee) || fee < 0 || fee > 20) throw new Error("PayPal fee percent must be from 0 to 20.");
  return {
    payment_methods: methods,
    payment_reasons: Array.isArray(input.payment_reasons) ? input.payment_reasons.map(String) : [],
    online_pay_enabled: input.online_pay_enabled === true,
    paypal_fee_pct: fee,
    zelle_handle: input.zelle_handle ? String(input.zelle_handle) : null,
  };
}

export async function savePaymentSettings(db: EditorDb, input: Record<string, unknown>) {
  const patch = paymentSettingsPatch(input);
  await must(db.from("payment_settings").update(patch).eq("id", true), "Saving payment settings");
  return patch;
}

export async function saveCompanyMail(db: EditorDb, input: { facebook?: string | null; instagram?: string | null; windowStart?: string | null; windowEnd?: string | null }) {
  for (const value of [input.facebook, input.instagram]) {
    if (value && !/^https:\/\//.test(value)) throw new Error("Social links must start with https://.");
  }
  const patch = {
    facebook_url: input.facebook ?? null,
    instagram_url: input.instagram ?? null,
    email_send_window_start: input.windowStart ?? null,
    email_send_window_end: input.windowEnd ?? null,
  };
  await must(db.from("company_settings").update(patch).eq("id", true), "Saving mail settings");
  return patch;
}

export async function saveVenueMileage(db: EditorDb, venueId: string, input: { enabled?: boolean; miles?: number | null }) {
  const miles = input.miles == null ? null : Number(input.miles);
  if (miles != null && (!Number.isFinite(miles) || miles < 0)) throw new Error("Miles must be a number.");
  await must(db.from("venues").update({ auto_mileage: input.enabled === true, distance_miles: miles }).eq("id", uuid(venueId, "Venue")), "Saving venue mileage");
  return { auto_mileage: input.enabled === true, distance_miles: miles };
}

export async function saveCatalogItem(db: EditorDb, table: "packages" | "addons", input: { id?: string | null; name?: string; price?: number; delete?: boolean }) {
  if (input.delete) {
    await must(db.from(table).delete().eq("id", uuid(input.id, "Item")), "Deleting the catalog item");
    return { ok: true };
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const price = Number(input.price ?? 0);
  if (!Number.isFinite(price) || price < 0) throw new Error("Price must be a number.");
  const row = { name, default_price: price };
  if (input.id) {
    await must(db.from(table).update(row).eq("id", uuid(input.id, "Item")), "Updating the catalog item");
    return row;
  }
  await must(db.from(table).insert(row), "Saving the catalog item");
  return row;
}

export async function saveEquipmentCatalog(db: EditorDb, input: { action: string; id?: string | null; name?: string; systemId?: string | null }) {
  if (input.action === "location") {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Location name is required.");
    await must(db.from("storage_locations").insert({ name }), "Saving the location");
    return { name };
  }
  if (input.action === "assign") {
    await must(db.from("equipment_items").update({ system_id: input.systemId ? uuid(input.systemId, "System") : null }).eq("id", uuid(input.id, "Item")), "Assigning the item");
    return { ok: true };
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const table = input.action === "system" ? "equipment_systems" : "equipment_items";
  if (input.id) {
    await must(db.from(table).update({ name }).eq("id", uuid(input.id, "Item")), "Updating equipment");
    return { name };
  }
  await must(db.from(table).insert({ name }), "Saving equipment");
  return { name };
}

export async function saveCustomDateDefinition(db: EditorDb, name: string) {
  const label = String(name ?? "").trim();
  if (!label) throw new Error("Date field name is required.");
  await must(db.from("custom_date_definitions").insert({ name: label }), "Saving the date field");
  return { name: label };
}

export async function markConversationRead(db: EditorDb, conversationId: string) {
  await must(db.from("hl_conversations").update({ unread_count: 0 }).eq("id", uuid(conversationId, "Conversation")), "Marking the conversation read");
  return { unread_count: 0 };
}

export async function linkFirefliesMeeting(db: EditorDb, eventId: string, meetingId: string, unlink: boolean) {
  const event = uuid(eventId, "Event");
  await must(db.from("fireflies_meetings").update({ event_id: unlink ? null : event, matched_by: "manual" }).eq("id", uuid(meetingId, "Meeting")), "Updating the meeting");
  return { event_id: unlink ? null : event };
}

export async function savePayrollSettings(db: EditorDb, input: { frequency?: string; anchor?: string | null }) {
  const frequency = input.frequency ?? "biweekly";
  if (!["weekly", "biweekly", "monthly"].includes(frequency)) throw new Error("Payroll frequency must be weekly, biweekly, or monthly.");
  await must(db.from("payroll_settings").update({ frequency, anchor_payday: input.anchor ?? null }).eq("id", true), "Saving payroll settings");
  return { frequency };
}

export async function saveManualPayable(db: EditorDb, input: { id?: string | null; employeeId?: string; amount?: number; delete?: boolean }) {
  if (input.delete) {
    await must(db.from("payroll_payables").delete().eq("id", uuid(input.id, "Payable")).eq("source", "manual"), "Deleting the payable");
    return { ok: true };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Payable amount must be a number.");
  await must(db.from("payroll_payables").insert({ employee_id: uuid(input.employeeId, "Employee"), amount, source: "manual" }), "Saving the payable");
  return { amount };
}

export async function saveEmailTemplateLifecycle(db: EditorDb, input: { action: string; id?: string | null; name?: string }) {
  if (input.action === "delete") {
    await must(db.from("email_templates").update({ is_active: false }).eq("id", uuid(input.id, "Template")), "Hiding the template");
    return { ok: true };
  }
  if (input.action === "duplicate") {
    const rows = await must(db.from("email_templates").select("name, subject, body_html, is_sms").eq("id", uuid(input.id, "Template")), "Loading the template");
    const row = (Array.isArray(rows) ? rows[0] : rows) as Row | undefined;
    if (!row) throw new Error("Template not found.");
    await must(db.from("email_templates").insert({ name: `${row.name} copy`, subject: row.subject ?? "", body_html: row.body_html ?? "", is_sms: row.is_sms === true, is_active: false }), "Copying the template");
    return { ok: true };
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Template name is required.");
  await must(db.from("email_templates").insert({ name, subject: "", body_html: "", is_active: false }), "Creating the template");
  return { name };
}

export async function savePlannerTemplateAdmin(db: EditorDb, input: { action: string; id?: string | null; name?: string }) {
  if (input.action === "delete") {
    await must(db.from("planning_templates").delete().eq("id", uuid(input.id, "Template")), "Deleting the planner template");
    return { ok: true };
  }
  if (input.action === "default") {
    await must(db.from("planning_templates").update({ is_default: false }).eq("is_default", true), "Clearing the default planner template");
    await must(db.from("planning_templates").update({ is_default: true }).eq("id", uuid(input.id, "Template")), "Setting the default planner template");
    return { ok: true };
  }
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Planner template name is required.");
  await must(db.from("planning_templates").insert({ name }), "Saving the planner template");
  return { name };
}

export async function savePhotoboothAdmin(db: EditorDb, input: { action: string; id?: string | null; active?: boolean; sort?: number }) {
  if (input.action === "delete") {
    await must(db.from("photobooth_backdrops").delete().eq("id", uuid(input.id, "Backdrop")), "Deleting the backdrop");
    return { ok: true };
  }
  if (input.action === "active") {
    await must(db.from("photobooth_backdrops").update({ is_active: input.active === true }).eq("id", uuid(input.id, "Backdrop")), "Updating the backdrop");
    return { is_active: input.active === true };
  }
  if (!Number.isInteger(input.sort)) throw new Error("Backdrop order must be a whole number.");
  await must(db.from("photobooth_backdrops").update({ sort_order: input.sort }).eq("id", uuid(input.id, "Backdrop")), "Ordering the backdrop");
  return { sort_order: input.sort };
}

export async function saveExpenseLists(db: EditorDb, categories: unknown) {
  if (!Array.isArray(categories) || categories.length === 0) throw new Error("Expense lists need at least one category.");
  const names = categories.map((item) => String(item).trim()).filter(Boolean);
  await must(db.from("expense_settings").update({ category_options: names }).eq("id", true), "Saving expense lists");
  return { category_options: names };
}

export async function saveNotificationAudience(db: EditorDb, input: { typeKey: string; audience: string; enabled: boolean; delete?: boolean }) {
  const audience = input.audience;
  if (!["master_admin", "admin", "salesperson", "employee", "event_salesperson", "event_assigned_staff"].includes(audience)) {
    throw new Error("That notification audience is not recognized.");
  }
  if (input.delete) {
    await must(db.from("notification_settings").delete().eq("type_key", input.typeKey).eq("audience", audience), "Removing the audience");
    return { ok: true };
  }
  await must(db.from("notification_settings").insert({ type_key: input.typeKey, audience, is_enabled: input.enabled, in_app: true, push: false, email: false, sms: false }), "Saving the audience");
  return { audience };
}

export async function saveHelperLifecycle(db: EditorDb, input: { action: string; id?: string | null; title?: string; position?: number }) {
  if (input.action === "delete") {
    await must(db.from("booking_helpers").delete().eq("id", uuid(input.id, "Helper")), "Deleting the helper");
    return { ok: true };
  }
  if (input.action === "move") {
    const position = Number(input.position);
    if (!Number.isInteger(position)) throw new Error("Helper position must be a whole number.");
    await must(db.from("booking_helpers").update({ position }).eq("id", uuid(input.id, "Helper")), "Moving the helper");
    return { position };
  }
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("A helper needs a title.");
  if (input.action === "duplicate") {
    const rows = await must(db.from("booking_helpers").select("title, button_text, actions").eq("id", uuid(input.id, "Helper")), "Loading the helper");
    const row = (Array.isArray(rows) ? rows[0] : rows) as Row | undefined;
    if (!row) throw new Error("Helper not found.");
    await must(db.from("booking_helpers").insert({ title: `${row.title} copy`, button_text: row.button_text ?? "Run", actions: row.actions ?? [], is_active: false }), "Copying the helper");
    return { ok: true };
  }
  if (input.action !== "create") throw new Error("Helper action must be create, duplicate, delete, or move.");
  await must(db.from("booking_helpers").insert({ title, button_text: "Run", actions: [], is_active: false }), "Creating the helper");
  return { title };
}

export function revertOverrideDecision(status: string | null, hasOverride: boolean) {
  if (!status) throw new Error("There is no override to revert.");
  if (status === "sent" || status === "marked_sent") throw new Error("This one already went out.");
  if (!hasOverride && status !== "pending") throw new Error("There is no override to revert.");
  return status === "pending" ? "delete" : "clear";
}
