/** Office editor rules shared by the staff forms and the agent tools.
    Empty restriction lists mean "all", matching the helper and template checklists.
    "only" with no ids is rejected so a restriction cannot silently become "all". */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const HELPER_ROLES = ["admin", "salesperson", "employee", "marketing"] as const;

export const REQUIRED_FIELD_KEYS = [
  "event_date", "setup_time", "start_time", "end_time", "guest_count", "venue", "package", "event_name",
  "client", "client_email", "client_cell",
] as const;

export const SCHEDULE_ANCHORS = [
  "event_date", "booked_date", "initial_contact_date", "contract_sent_date",
  "contract_due_date", "contract_signed_date", "quote_sent_date",
] as const;

export const SCHEDULE_SEND_TO = [
  "primary_client", "additional_clients", "venue", "vendors", "all_employees",
  "primary_employee", "unconfirmed_employees", "master_admin", "salesperson",
] as const;

export const SCHEDULE_FROM = ["company", "salesperson", "primary_dj", "point_of_contact", "master_admin"] as const;
export const PAYMENT_FILTERS = ["any", "none", "partial", "paid_full"] as const;
export const ADDON_MODES = ["all", "assigned", "not_assigned"] as const;
export const ANSWER_TYPES = ["short", "long", "yesno", "scale", "select", "multiselect", "image_select"] as const;
export const SECTION_TYPES = ["info", "timeline", "headline"] as const;

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

export type EditorQuery = PromiseLike<Result> & {
  eq(column: string, value: unknown): EditorQuery;
  in(column: string, values: unknown[]): EditorQuery;
  gte(column: string, value: unknown): EditorQuery;
  neq(column: string, value: unknown): EditorQuery;
  order(column: string, opts?: { ascending?: boolean }): EditorQuery;
  limit(n: number): EditorQuery;
  select(cols: string): EditorQuery;
  maybeSingle(): Promise<Result>;
  single(): Promise<Result>;
};

export type EditorDb = {
  from(table: string): {
    select(cols: string): EditorQuery;
    insert(row: Row | Row[]): EditorQuery & PromiseLike<Result>;
    update(patch: Row): EditorQuery & PromiseLike<Result>;
    delete(): EditorQuery & PromiseLike<Result>;
  };
};

function uuids(values: unknown, label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be a list of ids.`);
  const ids = values.map((value) => String(value).trim()).filter(Boolean);
  for (const id of ids) if (!UUID.test(id)) throw new Error(`${label} contains an invalid id.`);
  return ids;
}

function restriction(mode: unknown, ids: unknown, label: string): string[] {
  if (mode == null || mode === "all") return [];
  if (mode !== "only") throw new Error(`${label} mode must be all or only.`);
  const list = uuids(ids ?? [], label);
  if (list.length === 0) throw new Error(`${label} is set to only, so pick at least one.`);
  return list;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${label} must be one of ${allowed.join(", ")}.`);
}

function subset(values: unknown, allowed: readonly string[], label: string): string[] {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error(`${label} must be a list.`);
  const list = values.map((value) => String(value));
  for (const item of list) if (!allowed.includes(item)) throw new Error(`${label} cannot include ${item}.`);
  return list;
}

async function done(query: PromiseLike<Result>) {
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function row(query: PromiseLike<Result>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

async function list(query: PromiseLike<Result>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Row[]) : [];
}

export function helperVisibilityPatch(input: Record<string, unknown>): Row {
  const roleMode = input.mode_roles == null || input.mode_roles === "all" ? "all" : input.mode_roles;
  if (roleMode !== "all" && roleMode !== "only") throw new Error("Staff roles mode must be all or only.");
  const roles = roleMode === "all" ? [] : (Array.isArray(input.allowed_roles) ? input.allowed_roles.map(String) : []);
  if (roleMode === "only" && roles.length === 0) throw new Error("Staff roles is set to only, so pick at least one.");
  for (const role of roles) {
    if (!(HELPER_ROLES as readonly string[]).includes(role)) throw new Error(`Staff roles cannot include ${role}. Master Admin is always allowed.`);
  }
  const required = subset(input.required_fields, REQUIRED_FIELD_KEYS, "Required fields");
  return {
    visible_status_ids: restriction(input.mode_status, input.visible_status_ids, "Event statuses"),
    visible_event_type_ids: restriction(input.mode_event_type, input.visible_event_type_ids, "Event types"),
    allowed_roles: roles,
    hide_if_payment_made: input.hide_if_payment_made === true,
    hide_if_already_ran: input.hide_if_already_ran === true,
    hide_if_helpers_ran: uuids(input.hide_if_helpers_ran ?? [], "Other helpers"),
    required_fields: required,
    auto_on_create: input.auto_on_create === true,
    auto_status_ids: uuids(input.auto_status_ids ?? [], "Automatic statuses"),
    auto_on_proposal_confirmed: input.auto_on_proposal_confirmed === true,
    auto_on_signed: input.auto_on_signed === true,
    auto_on_payment: input.auto_on_payment === true,
    event_type_ids: uuids(input.event_type_ids ?? [], "Automatic event types"),
  };
}

export async function saveHelperVisibility(db: EditorDb, helperId: string, input: Record<string, unknown>) {
  const patch = helperVisibilityPatch(input);
  await done(db.from("booking_helpers").update(patch).eq("id", helperId));
  return patch;
}

export function templateSchedulePatch(input: Record<string, unknown>): Row {
  const time = input.schedule_send_time == null || input.schedule_send_time === "" ? "09:00" : String(input.schedule_send_time);
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Send time must be HH:MM.");
  const days = input.schedule_days == null || input.schedule_days === "" ? null : Number(input.schedule_days);
  if (days != null && (!Number.isInteger(days) || days < 0)) throw new Error("Schedule days must be a whole number or blank.");
  const packages = uuids(input.sched_package_ids ?? [], "Packages");
  const salespeople = uuids(input.sched_salesperson_ids ?? [], "Salespeople");
  const employees = uuids(input.sched_employee_ids ?? [], "Employees");
  const visPackages = uuids(input.vis_package_ids ?? [], "Visibility packages");
  return {
    schedule_enabled: input.schedule_enabled === true,
    schedule_days: days,
    schedule_direction: oneOf(input.schedule_direction, ["before", "after"] as const, "Schedule direction", "before"),
    schedule_anchor: oneOf(input.schedule_anchor, SCHEDULE_ANCHORS, "Schedule anchor", "event_date"),
    schedule_send_time: time,
    sched_status_ids: restriction(input.mode_status, input.sched_status_ids, "Schedule statuses"),
    sched_event_type_ids: restriction(input.mode_event_type, input.sched_event_type_ids, "Schedule event types"),
    sched_packages_mode: packages.length > 0 ? "selected" : "all",
    sched_package_ids: packages,
    sched_addons_mode: oneOf(input.sched_addons_mode, ADDON_MODES, "Addon filter", "all"),
    sched_addon_ids: uuids(input.sched_addon_ids ?? [], "Addons"),
    sched_payments: oneOf(input.sched_payments, PAYMENT_FILTERS, "Payment filter", "any"),
    sched_salesperson_mode: salespeople.length > 0 ? "selected" : "any",
    sched_salesperson_ids: salespeople,
    sched_employee_mode: employees.length > 0 ? "selected" : "any",
    sched_employee_ids: employees,
    schedule_from: oneOf(input.schedule_from, SCHEDULE_FROM, "Send from", "company"),
    sched_send_to: subset(input.sched_send_to, SCHEDULE_SEND_TO, "Send to"),
    sched_vendor_category_ids: uuids(input.sched_vendor_category_ids ?? [], "Vendor categories"),
    sched_exclude_declined: input.sched_exclude_declined === true,
    sched_also_send_to: input.sched_also_send_to == null ? null : String(input.sched_also_send_to).trim() || null,
    sched_set_status_id: input.sched_set_status_id ? uuids([input.sched_set_status_id], "Set status")[0] : null,
    sched_run_helper_id: input.sched_run_helper_id ? uuids([input.sched_run_helper_id], "Run helper")[0] : null,
    vis_status_ids: restriction(input.vis_mode_status, input.vis_status_ids, "Visibility statuses"),
    vis_event_type_ids: restriction(input.vis_mode_event_type, input.vis_event_type_ids, "Visibility event types"),
    vis_packages_mode: visPackages.length > 0 ? "selected" : "all",
    vis_package_ids: visPackages,
    vis_addons_mode: oneOf(input.vis_addons_mode, ADDON_MODES, "Visibility addon filter", "all"),
    vis_addon_ids: uuids(input.vis_addon_ids ?? [], "Visibility addons"),
    employee_visibility: oneOf(input.employee_visibility, ["admins_salespeople", "all"] as const, "Employee visibility", "admins_salespeople"),
    is_inbox_reply: input.is_inbox_reply === true,
    is_vendor_template: input.is_vendor_template === true,
    is_venue_template: input.is_venue_template === true,
  };
}

export async function saveTemplateSchedule(db: EditorDb, templateId: string, input: Record<string, unknown>) {
  const patch = { ...templateSchedulePatch(input), review_reasons: [] };
  await done(db.from("email_templates").update(patch).eq("id", templateId));
  return patch;
}

function questionOptions(answerType: string, options: unknown, updating: boolean): unknown[] | undefined {
  if (!ANSWER_TYPES.includes(answerType as (typeof ANSWER_TYPES)[number])) {
    throw new Error(`Answer type must be one of ${ANSWER_TYPES.join(", ")}.`);
  }
  if (["short", "long", "yesno", "scale"].includes(answerType)) return [];
  if (options == null) {
    if (updating && answerType === "image_select") return undefined;
    if (answerType === "select" || answerType === "multiselect") throw new Error("This answer type needs at least one option.");
    return [];
  }
  if (!Array.isArray(options) || options.length === 0) throw new Error("This answer type needs at least one option.");
  if (answerType === "image_select") {
    return options.map((option) => {
      if (!option || typeof option !== "object" || !String((option as { label?: string }).label ?? "").trim()) {
        throw new Error("Photo options need a label.");
      }
      const row = option as { label: string; image?: string | null };
      return { label: String(row.label).trim(), image: row.image ?? null };
    });
  }
  return options.map((option) => {
    const label = typeof option === "string" ? option : String((option as { label?: string })?.label ?? "");
    if (!label.trim()) throw new Error("Options cannot be blank.");
    return label.trim();
  });
}

export function plannerQuestion(input: Record<string, unknown>, updating: boolean) {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new Error("A question needs a prompt.");
  const answerType = String(input.answer_type ?? "short");
  const options = questionOptions(answerType, input.options, updating);
  const question: Row = {
    prompt,
    answer_type: answerType,
    help_text: input.help_text == null ? null : String(input.help_text).trim() || null,
    required: input.required === true,
  };
  if (options !== undefined) question.options = options;
  if ("condition_question_id" in input) {
    question.condition_question_id = input.condition_question_id ? uuids([input.condition_question_id], "Condition question")[0] : null;
    question.condition_values = Array.isArray(input.condition_values) ? input.condition_values.map(String) : [];
  }
  return question;
}

export async function addTemplateQuestion(db: EditorDb, templateId: string, sectionId: string, input: Record<string, unknown>) {
  const section = await row(db.from("planning_template_sections").select("id, template_id").eq("id", sectionId).eq("template_id", templateId).maybeSingle());
  if (!section) throw new Error("That section is not on this planner template.");
  const last = await row(db.from("planning_template_questions").select("sort_order").eq("template_section_id", sectionId).order("sort_order", { ascending: false }).limit(1).maybeSingle());
  const question = plannerQuestion(input, false);
  const created = await row(db.from("planning_template_questions").insert({
    ...question,
    template_section_id: sectionId,
    sort_order: ((last?.sort_order as number | null) ?? -1) + 1,
  }).select("id").single());
  return { id: created?.id ?? null };
}

export async function updateTemplateQuestion(db: EditorDb, templateId: string, questionId: string, input: Record<string, unknown>) {
  const existing = await row(db.from("planning_template_questions").select("id, template_section_id, answer_type").eq("id", questionId).maybeSingle());
  if (!existing) throw new Error("Question not found.");
  const section = await row(db.from("planning_template_sections").select("id").eq("id", existing.template_section_id).eq("template_id", templateId).maybeSingle());
  if (!section) throw new Error("That question is not on this planner template.");
  const question = plannerQuestion({ ...input, answer_type: input.answer_type ?? existing.answer_type }, true);
  await done(db.from("planning_template_questions").update(question).eq("id", questionId));
  return { ok: true };
}

export async function deleteTemplateQuestion(db: EditorDb, templateId: string, questionId: string) {
  const existing = await row(db.from("planning_template_questions").select("id, template_section_id").eq("id", questionId).maybeSingle());
  if (!existing) throw new Error("Question not found.");
  const section = await row(db.from("planning_template_sections").select("id").eq("id", existing.template_section_id).eq("template_id", templateId).maybeSingle());
  if (!section) throw new Error("That question is not on this planner template.");
  await done(db.from("planning_template_questions").delete().eq("id", questionId));
  return { ok: true };
}

export async function addTemplateSection(db: EditorDb, templateId: string, input: { title?: string | null; section_type?: string | null; icon?: string | null }) {
  const sectionType = oneOf(input.section_type, SECTION_TYPES, "Section type", "timeline");
  const last = await row(db.from("planning_template_sections").select("sort_order").eq("template_id", templateId).order("sort_order", { ascending: false }).limit(1).maybeSingle());
  const title = input.title?.trim() || (sectionType === "headline" ? "New Chapter" : "New Moment");
  const created = await row(db.from("planning_template_sections").insert({
    template_id: templateId,
    title,
    icon: input.icon?.trim() || null,
    section_type: sectionType,
    songs_enabled: sectionType !== "headline",
    sort_order: ((last?.sort_order as number | null) ?? -1) + 1,
  }).select("id").single());
  return { id: created?.id ?? null, title, section_type: sectionType };
}

const EVENT_SECTION_KEYS = [
  "title", "icon", "intro", "section_type", "guest_enabled", "song_limit", "must_play_limit",
  "songs_enabled", "questions_enabled", "notes_enabled", "time_enabled", "time_label", "on_timeline", "on_music",
] as const;

export function eventSectionPatch(input: Record<string, unknown>): Row {
  const patch: Row = {};
  for (const key of EVENT_SECTION_KEYS) if (key in input) patch[key] = input[key];
  if ("section_type" in patch) patch.section_type = oneOf(patch.section_type, SECTION_TYPES, "Section type", "timeline");
  if ("title" in patch && !String(patch.title ?? "").trim()) throw new Error("A section needs a title.");
  if (Object.keys(patch).length === 0) throw new Error("No section settings were provided.");
  return patch;
}

export async function updateEventSection(db: EditorDb, eventId: string, sectionId: string, input: Record<string, unknown>) {
  const patch = eventSectionPatch(input);
  const existing = await row(db.from("planning_sections").select("id").eq("id", sectionId).eq("event_id", eventId).maybeSingle());
  if (!existing) throw new Error("That section is not on this event.");
  await done(db.from("planning_sections").update(patch).eq("id", sectionId).eq("event_id", eventId));
  return patch;
}

export async function addEventSection(db: EditorDb, eventId: string, input: { title?: string | null; section_type?: string | null; after_sort_order?: number | null }) {
  const sectionType = oneOf(input.section_type, ["timeline", "headline"] as const, "Section type", "timeline");
  const pos = (input.after_sort_order ?? -1) + 1;
  const rows = await list(db.from("planning_sections").select("id, sort_order").eq("event_id", eventId).gte("sort_order", pos));
  for (const item of rows) {
    await done(db.from("planning_sections").update({ sort_order: Number(item.sort_order) + 1 }).eq("id", item.id));
  }
  const title = input.title?.trim() || (sectionType === "headline" ? "New Chapter" : "New Moment");
  const created = await row(db.from("planning_sections").insert({
    event_id: eventId,
    title,
    section_type: sectionType,
    sort_order: pos,
  }).select("id").single());
  return { id: created?.id ?? null, title, sort_order: pos };
}

export async function addEventQuestion(db: EditorDb, eventId: string, sectionId: string, input: Record<string, unknown>) {
  const section = await row(db.from("planning_sections").select("id").eq("id", sectionId).eq("event_id", eventId).maybeSingle());
  if (!section) throw new Error("That section is not on this event.");
  const last = await row(db.from("planning_questions").select("sort_order").eq("section_id", sectionId).order("sort_order", { ascending: false }).limit(1).maybeSingle());
  const question = plannerQuestion(input, false);
  const created = await row(db.from("planning_questions").insert({
    ...question,
    section_id: sectionId,
    event_id: eventId,
    sort_order: ((last?.sort_order as number | null) ?? -1) + 1,
  }).select("id").single());
  return { id: created?.id ?? null };
}

export async function updateEventQuestion(db: EditorDb, eventId: string, questionId: string, input: Record<string, unknown>) {
  const existing = await row(db.from("planning_questions").select("id, answer_type").eq("id", questionId).eq("event_id", eventId).maybeSingle());
  if (!existing) throw new Error("That question is not on this event.");
  const question = plannerQuestion({ ...input, answer_type: input.answer_type ?? existing.answer_type }, true);
  await done(db.from("planning_questions").update(question).eq("id", questionId).eq("event_id", eventId));
  return { ok: true };
}

export function contactPatch(input: Record<string, unknown>): Row {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("A contact needs a name.");
  const email = input.email == null ? null : String(input.email).trim() || null;
  if (email && !email.includes("@")) throw new Error("Contact email must contain @.");
  return {
    name,
    role: input.role == null ? null : String(input.role).trim() || null,
    phone: input.phone == null ? null : String(input.phone).trim() || null,
    email,
  };
}

export async function addContact(db: EditorDb, table: "venue_contacts" | "vendor_contacts", parentColumn: "venue_id" | "vendor_id", parentId: string, input: Record<string, unknown>) {
  const patch = contactPatch(input);
  const created = await row(db.from(table).insert({ ...patch, [parentColumn]: parentId }).select("id").single());
  return { id: created?.id ?? null, ...patch };
}

export async function removeContact(db: EditorDb, table: "venue_contacts" | "vendor_contacts", parentColumn: "venue_id" | "vendor_id", parentId: string, contactId: string) {
  const existing = await row(db.from(table).select("id").eq("id", contactId).eq(parentColumn, parentId).maybeSingle());
  if (!existing) throw new Error("That contact is not on this record.");
  await done(db.from(table).delete().eq("id", contactId).eq(parentColumn, parentId));
  return { ok: true };
}

/** Existing Spotify connections can be used. Starting a login is not this connector's job. */
export function coerceMoney(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  return number;
}

export function onboardingEffects(input: { staff?: { flat_wage?: unknown }[]; newVenue?: { name?: string | null } | null; newSourceName?: string | null; packagePriceOverride?: unknown; depositValue?: unknown; travelFee?: unknown }) {
  const staff = (input.staff ?? []).map((row) => ({ ...row, flat_wage: coerceMoney(row.flat_wage, "Wage") }));
  const needs = new Set<string>();
  if (staff.some((row) => row.flat_wage != null && row.flat_wage !== 0)) needs.add("money.payroll");
  if (input.newVenue?.name) needs.add("write.venues");
  if (input.newSourceName) needs.add("write.settings");
  if (coerceMoney(input.packagePriceOverride, "Price override") != null) needs.add("money");
  if (coerceMoney(input.depositValue, "Deposit") != null) needs.add("money");
  if (coerceMoney(input.travelFee, "Travel fee") != null && coerceMoney(input.travelFee, "Travel fee") !== 0) needs.add("money");
  return { staff, scopes: [...needs] };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const BLOCK_TYPES = ["text", "section", "fee_table", "payment_schedule", "event_details", "signature", "divider"] as const;

export function weekdayPrices(input: Record<string, unknown>): Record<string, number> {
  const prices: Record<string, number> = {};
  for (let day = 0; day <= 6; day++) {
    const value = input[String(day)] ?? input[`weekday_${day}`];
    if (value == null || value === "") continue;
    const amount = coerceMoney(value, `Weekday ${day}`);
    if (amount == null) continue;
    if (amount < 0) throw new Error(`Weekday ${day} cannot be negative.`);
    prices[String(day)] = amount;
  }
  return prices;
}

export async function saveWeekdayPrices(db: EditorDb, packageId: string, input: Record<string, unknown>) {
  const weekday_prices = weekdayPrices(input);
  await done(db.from("packages").update({ weekday_prices }).eq("id", packageId));
  return { weekday_prices };
}

export function helperButtonPatch(input: Record<string, unknown>): Row {
  const fontSize = Number(input.button_font_size ?? 16);
  const fontWeight = Number(input.button_font_weight ?? 900);
  if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 32) throw new Error("Button font size must be a whole number from 10 to 32.");
  if (![400, 500, 600, 700, 800, 900].includes(fontWeight)) throw new Error("Button font weight must be 400, 500, 600, 700, 800, or 900.");
  const background = String(input.button_bg ?? "#97CC9A");
  const foreground = String(input.button_fg ?? "#000000");
  if (!HEX.test(background) || !HEX.test(foreground)) throw new Error("Button colors must be #RRGGBB.");
  const text = String(input.button_text ?? "").trim();
  if (!text) throw new Error("A helper button needs text.");
  return { button_text: text, button_bg: background, button_fg: foreground, button_font_size: fontSize, button_font_weight: fontWeight };
}

export async function saveHelperButton(db: EditorDb, helperId: string, input: Record<string, unknown>) {
  const patch = helperButtonPatch(input);
  await done(db.from("booking_helpers").update(patch).eq("id", helperId));
  return patch;
}

export function documentBlocks(value: unknown): { id: string; type: string; title?: string; html?: string }[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("A document template needs at least one block.");
  return value.map((block, index) => {
    if (!block || typeof block !== "object") throw new Error(`Block ${index + 1} is invalid.`);
    const row = block as { id?: string; type?: string; title?: string; html?: string };
    if (!row.type || !(BLOCK_TYPES as readonly string[]).includes(row.type)) throw new Error(`Block ${index + 1} has an unknown type.`);
    const id = row.id && UUID.test(row.id) ? row.id : crypto.randomUUID();
    const next: { id: string; type: string; title?: string; html?: string } = { id, type: row.type };
    if (row.type === "section") {
      const title = String(row.title ?? "").trim();
      if (!title) throw new Error(`Section block ${index + 1} needs a title.`);
      next.title = title;
      next.html = String(row.html ?? "");
    }
    if (row.type === "text") next.html = String(row.html ?? "");
    return next;
  });
}

export async function saveDocumentBlocks(db: EditorDb, templateId: string, blocks: unknown, name?: string | null) {
  const next = documentBlocks(blocks);
  const patch: Row = { blocks: next };
  if (name != null) patch.name = name.trim() || "Untitled";
  await done(db.from("document_templates").update(patch).eq("id", templateId));
  return { blocks: next };
}

export function backdropPatch(input: Record<string, unknown>): Row {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("A backdrop needs a name.");
  return { name, category: input.category == null ? null : String(input.category).trim() || null, is_active: input.is_active !== false };
}

export async function saveBackdrop(db: EditorDb, id: string | null, input: Record<string, unknown>) {
  const patch = backdropPatch(input);
  if (id) {
    await done(db.from("photobooth_backdrops").update(patch).eq("id", id));
    return { id, ...patch };
  }
  const created = await row(db.from("photobooth_backdrops").insert(patch).select("id").single());
  return { id: created?.id ?? null, ...patch };
}

export function briefingPref(input: Record<string, unknown>): Row {
  const frequency = input.frequency == null ? undefined : String(input.frequency);
  if (frequency != null && !["daily", "weekdays", "weekly"].includes(frequency)) throw new Error("Briefing frequency must be daily, weekdays, or weekly.");
  const patch: Row = {};
  if ("enabled" in input) patch.enabled = input.enabled === true;
  if (frequency != null) patch.frequency = frequency;
  if (Object.keys(patch).length === 0) throw new Error("No briefing preference was provided.");
  return patch;
}

export async function saveBriefingPref(db: EditorDb, employeeId: string, input: Record<string, unknown>) {
  const patch = { ...briefingPref(input), employee_id: employeeId };
  await done(db.from("staff_briefing_prefs").update(patch).eq("employee_id", employeeId));
  return patch;
}

export function articlePatch(input: Record<string, unknown>, creating: boolean): Row {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("An article needs a title.");
  const content = String(input.content ?? "");
  if (creating && !content.trim()) throw new Error("An article needs content.");
  return { title, content, category: input.category == null ? null : String(input.category).trim() || null };
}

export async function saveArticle(db: EditorDb, id: string | null, input: Record<string, unknown>) {
  const patch = articlePatch(input, !id);
  if (id) {
    await done(db.from("kb_articles").update(patch).eq("id", id));
    return { id, ...patch };
  }
  const created = await row(db.from("kb_articles").insert(patch).select("id").single());
  return { id: created?.id ?? null, ...patch };
}

export function inviteEffect(input: { email?: string | null; templateSubject?: string | null; templateBody?: string | null }) {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Invite needs a client email.");
  const placeholder = "[one-time-link:set-password]";
  const body = (input.templateBody ?? `Set your password: ${placeholder}`).split("<set_password_link>").join(placeholder).split("<set_password_button>").join(placeholder);
  return {
    to: email,
    subject: input.templateSubject ?? "Set your password",
    body,
    link: placeholder,
    link_kind: "set-password" as const,
    invariant: "Recipient, subject, and body stay as approved. Only the recovery token inside the set-password redirect may differ at send time.",
  };
}

export function spotifyExistingConnection(connection: { connected?: boolean; canWrite?: boolean }) {
  if (!connection.connected) return { ok: false as const, reason: "needs_connect" as const };
  if (connection.canWrite === false) return { ok: false as const, reason: "needs_reconnect" as const };
  return { ok: true as const };
}
