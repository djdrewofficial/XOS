/* Scheduled communications for one event.
   Mirrors public.run_scheduled_emails(): which active templates match, the day
   they go out, and what a staff skip / edit / "already sent" does to that one
   occurrence. The SQL function is what actually queues the message; this module
   is the list the Comms tab shows and the rules the buttons follow. */

export const RECENT_DAYS = 90;

export const ANCHOR_LABELS: Record<string, string> = {
  event_date: "event date",
  booked_date: "date booked",
  initial_contact_date: "initial contact date",
  contract_sent_date: "contract sent date",
  contract_due_date: "contract due date",
  contract_signed_date: "contract signed date",
  quote_sent_date: "quote sent date",
};

export const AUDIENCE_LABELS: Record<string, string> = {
  primary_client: "Primary client",
  additional_clients: "Additional client",
  venue: "Venue",
  vendors: "Vendor",
  all_employees: "Assigned employee",
  primary_employee: "Primary employee",
  unconfirmed_employees: "Unconfirmed employee",
  master_admin: "Master administrator",
  salesperson: "Salesperson",
};

const CLIENT_AUDIENCES = new Set(["primary_client", "additional_clients"]);

export type ScheduleTemplate = {
  id: string;
  name: string;
  displayName: string | null;
  isSms: boolean;
  subject: string;
  bodyHtml: string;
  isRawHtml: boolean;
  scheduleDays: number;
  scheduleDirection: "before" | "after";
  scheduleAnchor: string;
  /** "HH:MM:SS" in the company timezone. */
  scheduleSendTime: string;
  schedStatusIds: string[];
  schedEventTypeIds: string[];
  schedPackagesMode: string;
  schedPackageIds: string[];
  schedAddonsMode: string;
  schedAddonIds: string[];
  schedPayments: string;
  schedSalespersonMode: string;
  schedSalespersonIds: string[];
  schedEmployeeMode: string;
  schedEmployeeIds: string[];
  schedSendTo: string[];
  schedExcludeDeclined: boolean;
  schedAlsoSendTo: string | null;
  schedVendorCategoryIds: string[];
};

export type AnchorDates = {
  eventDate: string | null;
  bookedDate: string | null;
  initialContactDate: string | null;
  contractSentDate: string | null;
  contractDueDate: string | null;
  contractSignedDate: string | null;
  quoteSentDate: string | null;
};

/** Facts the scheduler reads off the event. Payment math matches the SQL
    function (package override or live catalog price, addon override or catalog
    price, fees, discounts; every payment row). It is not the on-screen Investment. */
export type ScheduleEventFacts = AnchorDates & {
  statusId: string | null;
  eventTypeId: string | null;
  packageId: string | null;
  salespersonId: string | null;
  addonIds: string[];
  schedulerTotal: number;
  paymentsSum: number;
  staffEmployeeIds: string[];
};

export type ScheduleRunStatus = "pending" | "sent" | "skipped" | "marked_sent";

export type ScheduleRun = {
  templateId: string;
  targetDate: string;
  status: ScheduleRunStatus;
  sentAt: string | null;
  actedByName: string | null;
  actedAt: string | null;
  overrideSubject: string | null;
  overrideBodyHtml: string | null;
  overrideIsRawHtml: boolean | null;
  editedByName: string | null;
  editedAt: string | null;
};

export type DirectoryPerson = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type DirectoryStaff = DirectoryPerson & {
  /** event_staff.id — the scheduler orders the primary employee by this. */
  staffId: string;
  role: string | null;
  declinedAt: string | null;
  confirmedAt: string | null;
};

export type DirectoryVendor = {
  name: string;
  categoryId: string | null;
  emails: string[];
  phones: string[];
};

export type RecipientDirectory = {
  primary: DirectoryPerson | null;
  additional: DirectoryPerson[];
  venue: DirectoryPerson | null;
  vendors: DirectoryVendor[];
  salesperson: DirectoryPerson | null;
  staff: DirectoryStaff[];
  masterAdminEmail: string | null;
  masterAdmins: DirectoryPerson[];
};

export type ScheduledRecipient = {
  label: string;
  /** Email address or phone. Null when that audience is selected but has nothing on file. */
  detail: string | null;
};

export type ScheduledCommState = "upcoming" | "due" | "sent" | "skipped" | "marked_sent" | "not_sent";

export type ScheduledCommItem = {
  key: string;
  templateId: string;
  templateName: string;
  channel: "email" | "sms";
  targetDate: string;
  sendTime: string;
  whenLabel: string;
  ruleLabel: string;
  recipients: ScheduledRecipient[];
  recipientSummary: string;
  state: ScheduledCommState;
  stateLabel: string;
  section: "upcoming" | "recent";
  edited: boolean;
  auditLines: string[];
  pauseNote: string | null;
  subject: string;
  bodyHtml: string;
  isRawHtml: boolean;
  isSms: boolean;
  canSkip: boolean;
  canUndoSkip: boolean;
  canEdit: boolean;
  canMarkSent: boolean;
  canRevert: boolean;
};

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function normalizeTime(value: string | null | undefined): string {
  const [h = "0", m = "0", s = "0"] = (value ?? "09:00").split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${(s || "0").padStart(2, "0")}`.slice(0, 8);
}

/** Company-local calendar date (YYYY-MM-DD) and time (HH:MM:SS). */
export function zonedParts(now: Date, timeZone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = bag.hour === "24" ? "00" : bag.hour;
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    time: `${hour}:${bag.minute}:${bag.second}`,
  };
}

export function anchorDate(anchor: string, dates: AnchorDates): string | null {
  switch (anchor) {
    case "event_date":
      return dates.eventDate;
    case "booked_date":
      return dates.bookedDate;
    case "initial_contact_date":
      return dates.initialContactDate;
    case "contract_sent_date":
      return dates.contractSentDate;
    case "contract_due_date":
      return dates.contractDueDate;
    case "contract_signed_date":
      return dates.contractSignedDate;
    case "quote_sent_date":
      return dates.quoteSentDate;
    default:
      return dates.eventDate;
  }
}

/** The calendar day run_scheduled_emails will compare to "today". */
export function targetDateFor(
  template: Pick<ScheduleTemplate, "scheduleDays" | "scheduleDirection" | "scheduleAnchor">,
  dates: AnchorDates,
): string | null {
  const anchor = anchorDate(template.scheduleAnchor, dates);
  if (!anchor) return null;
  const days = template.scheduleDirection === "before" ? -template.scheduleDays : template.scheduleDays;
  return addDays(anchor.slice(0, 10), days);
}

function hasIds(ids: string[] | null | undefined): boolean {
  return Array.isArray(ids) && ids.length > 0;
}

/** Same gates as the scheduler, except the exact-day check (the list shows a window). */
export function templateMatchesEvent(template: ScheduleTemplate, event: ScheduleEventFacts): boolean {
  if (hasIds(template.schedStatusIds) && (!event.statusId || !template.schedStatusIds.includes(event.statusId))) {
    return false;
  }
  if (
    hasIds(template.schedEventTypeIds) &&
    (!event.eventTypeId || !template.schedEventTypeIds.includes(event.eventTypeId))
  ) {
    return false;
  }
  if (template.schedPackagesMode === "selected" && (!event.packageId || !template.schedPackageIds.includes(event.packageId))) {
    return false;
  }
  if (template.schedAddonsMode === "assigned" && !event.addonIds.some((id) => template.schedAddonIds.includes(id))) {
    return false;
  }
  if (template.schedAddonsMode === "not_assigned" && event.addonIds.some((id) => template.schedAddonIds.includes(id))) {
    return false;
  }
  if (
    template.schedSalespersonMode === "selected" &&
    (!event.salespersonId || !template.schedSalespersonIds.includes(event.salespersonId))
  ) {
    return false;
  }
  if (
    template.schedEmployeeMode === "selected" &&
    !event.staffEmployeeIds.some((id) => template.schedEmployeeIds.includes(id))
  ) {
    return false;
  }
  if (template.schedPayments === "none" && event.paymentsSum !== 0) return false;
  if (template.schedPayments === "partial" && !(event.paymentsSum > 0 && event.paymentsSum < event.schedulerTotal)) {
    return false;
  }
  if (template.schedPayments === "paid_full" && event.paymentsSum < event.schedulerTotal) return false;
  return true;
}

function personLine(label: string, person: DirectoryPerson | null, channel: "email" | "sms"): ScheduledRecipient {
  const detail = person ? (channel === "sms" ? person.phone : person.email) : null;
  const named = person?.name ? `${label} · ${person.name}` : label;
  return { label: named, detail: detail && detail.trim() !== "" ? detail.trim() : null };
}

function primaryStaff(staff: DirectoryStaff[], channel: "email" | "sms"): DirectoryStaff | null {
  const eligible = staff.filter((s) => (channel === "sms" ? s.phone : s.email));
  eligible.sort((a, b) => {
    const aDj = /dj/i.test(a.role ?? "") ? 0 : 1;
    const bDj = /dj/i.test(b.role ?? "") ? 0 : 1;
    if (aDj !== bDj) return aDj - bDj;
    return a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0;
  });
  return eligible[0] ?? null;
}

export function resolveRecipients(
  template: Pick<ScheduleTemplate, "isSms" | "schedSendTo" | "schedExcludeDeclined" | "schedAlsoSendTo" | "schedVendorCategoryIds">,
  directory: RecipientDirectory,
): ScheduledRecipient[] {
  const channel = template.isSms ? "sms" : "email";
  const out: ScheduledRecipient[] = [];
  const sendTo = template.schedSendTo ?? [];

  if (sendTo.includes("primary_client")) out.push(personLine("Primary client", directory.primary, channel));
  if (sendTo.includes("additional_clients")) {
    if (directory.additional.length === 0) out.push({ label: "Additional clients", detail: null });
    for (const person of directory.additional) out.push(personLine("Additional client", person, channel));
  }
  if (sendTo.includes("venue")) out.push(personLine("Venue", directory.venue, channel));
  if (sendTo.includes("vendors")) {
    const cats = template.schedVendorCategoryIds ?? [];
    const vendors = directory.vendors.filter((v) => cats.length === 0 || (v.categoryId != null && cats.includes(v.categoryId)));
    if (vendors.length === 0) out.push({ label: "Vendors", detail: null });
    for (const vendor of vendors) {
      const details = channel === "sms" ? vendor.phones : vendor.emails;
      if (details.length === 0) out.push({ label: `Vendor · ${vendor.name}`, detail: null });
      for (const detail of details) out.push({ label: `Vendor · ${vendor.name}`, detail });
    }
  }
  if (sendTo.includes("salesperson")) out.push(personLine("Salesperson", directory.salesperson, channel));
  if (sendTo.includes("all_employees")) {
    const list = directory.staff.filter((s) => !template.schedExcludeDeclined || !s.declinedAt);
    if (list.length === 0) out.push({ label: "Assigned employees", detail: null });
    for (const person of list) out.push(personLine("Assigned employee", person, channel));
  }
  if (sendTo.includes("primary_employee")) {
    out.push(personLine("Primary employee", primaryStaff(directory.staff, channel), channel));
  }
  if (sendTo.includes("unconfirmed_employees")) {
    const list = directory.staff.filter((s) => !s.confirmedAt && !s.declinedAt);
    if (list.length === 0) out.push({ label: "Unconfirmed employees", detail: null });
    for (const person of list) out.push(personLine("Unconfirmed employee", person, channel));
  }
  if (sendTo.includes("master_admin")) {
    if (channel === "sms") {
      if (directory.masterAdmins.length === 0) out.push({ label: "Master administrator", detail: null });
      for (const person of directory.masterAdmins) {
        if (person.phone) out.push({ label: `Master administrator · ${person.name}`, detail: person.phone });
      }
      if (directory.masterAdmins.length > 0 && directory.masterAdmins.every((p) => !p.phone)) {
        out.push({ label: "Master administrator", detail: null });
      }
    } else {
      out.push({
        label: "Master administrator",
        detail: directory.masterAdminEmail,
      });
    }
  }
  const also = (template.schedAlsoSendTo ?? "").trim();
  if (also) {
    for (const piece of also.split(",")) {
      const detail = piece.trim();
      if (detail) out.push({ label: "Also", detail });
    }
  }
  return out;
}

function recipientSummary(recipients: ScheduledRecipient[]): string {
  if (recipients.length === 0) return "No recipients";
  return recipients
    .map((r) => (r.detail ? `${r.label} · ${r.detail}` : `${r.label} (nothing on file)`))
    .join(", ");
}

function formatClock(sendTime: string): string {
  const [hRaw, mRaw] = normalizeTime(sendTime).split(":");
  const hour = Number(hRaw);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${mRaw} ${suffix}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

function formatStamp(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

function relativeDay(target: string, today: string): string {
  if (target === today) return "Today";
  const [ty, tm, td] = target.split("-").map(Number);
  const [cy, cm, cd] = today.split("-").map(Number);
  const diff = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(cy, cm - 1, cd)) / 86_400_000,
  );
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1) return `In ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

function ruleLabel(template: ScheduleTemplate): string {
  const days = template.scheduleDays;
  const unit = days === 1 ? "day" : "days";
  const anchor = ANCHOR_LABELS[template.scheduleAnchor] ?? "event date";
  const direction = template.scheduleDirection === "before" ? "before" : "after";
  return `${days} ${unit} ${direction} the ${anchor}`;
}

function pauseNote(template: ScheduleTemplate, commsPaused: boolean): string | null {
  if (!commsPaused) return null;
  if (!template.isSms) return "Won't send while automated comms are paused.";
  const clientFacing = template.schedSendTo.some((id) => CLIENT_AUDIENCES.has(id));
  if (!clientFacing) return null;
  return "Client texts won't send while automated comms are paused. Staff texts still go out.";
}

function stateOf(
  run: ScheduleRun | undefined,
  targetDate: string,
  sendTime: string,
  today: string,
  nowTime: string,
): ScheduledCommState {
  if (run?.status === "sent") return "sent";
  if (run?.status === "skipped") return "skipped";
  if (run?.status === "marked_sent") return "marked_sent";
  if (targetDate < today) return "not_sent";
  if (targetDate === today && normalizeTime(sendTime) <= nowTime) return "due";
  return "upcoming";
}

const STATE_LABELS: Record<ScheduledCommState, string> = {
  upcoming: "Scheduled",
  due: "Sending soon",
  sent: "Sent",
  skipped: "Skipped",
  marked_sent: "Marked sent",
  not_sent: "Not sent",
};

function templateName(template: ScheduleTemplate): string {
  return (template.displayName || template.name || "Untitled").trim();
}

function itemFrom(
  template: ScheduleTemplate,
  targetDate: string,
  run: ScheduleRun | undefined,
  directory: RecipientDirectory,
  commsPaused: boolean,
  today: string,
  nowTime: string,
  timeZone: string,
): ScheduledCommItem {
  const state = stateOf(run, targetDate, template.scheduleSendTime, today, nowTime);
  const sendable = targetDate >= today && state !== "sent" && state !== "marked_sent";
  const edited = run?.overrideBodyHtml != null || run?.overrideSubject != null;
  const recipients = resolveRecipients(template, directory);
  const channel = template.isSms ? "sms" : "email";
  const auditLines: string[] = [];
  if (state === "sent") {
    const when = formatStamp(run?.sentAt ?? null, timeZone);
    auditLines.push(when ? `Sent ${when}` : "Sent by the scheduler");
  }
  if (state === "skipped") {
    const when = formatStamp(run?.actedAt ?? null, timeZone);
    const who = run?.actedByName ? ` by ${run.actedByName}` : "";
    auditLines.push(`Skipped${who}${when ? ` · ${when}` : ""}`);
  }
  if (state === "marked_sent") {
    const when = formatStamp(run?.actedAt ?? null, timeZone);
    const who = run?.actedByName ? ` by ${run.actedByName}` : "";
    auditLines.push(`Marked sent${who}${when ? ` · ${when}` : ""}`);
  }
  if (edited) {
    const when = formatStamp(run?.editedAt ?? null, timeZone);
    const who = run?.editedByName ? ` by ${run.editedByName}` : "";
    auditLines.push(`Edited for this event${who}${when ? ` · ${when}` : ""}`);
  }
  return {
    key: `${template.id}:${targetDate}`,
    templateId: template.id,
    templateName: templateName(template),
    channel,
    targetDate,
    sendTime: normalizeTime(template.scheduleSendTime),
    whenLabel: `${relativeDay(targetDate, today)} · ${formatDate(targetDate)} · ${formatClock(template.scheduleSendTime)}`,
    ruleLabel: ruleLabel(template),
    recipients,
    recipientSummary: recipientSummary(recipients),
    state,
    stateLabel: STATE_LABELS[state],
    section: targetDate >= today ? "upcoming" : "recent",
    edited,
    auditLines,
    pauseNote: state === "sent" || state === "skipped" || state === "marked_sent" || state === "not_sent" ? null : pauseNote(template, commsPaused),
    subject: run?.overrideSubject ?? template.subject,
    bodyHtml: run?.overrideBodyHtml ?? template.bodyHtml,
    isRawHtml: run?.overrideIsRawHtml ?? template.isRawHtml,
    isSms: template.isSms,
    canSkip: state === "upcoming" || state === "due",
    canUndoSkip: state === "skipped" && targetDate >= today,
    canEdit: sendable,
    canMarkSent: state !== "sent" && state !== "marked_sent",
    canRevert: edited && sendable,
  };
}

export function buildScheduledComms(input: {
  /** Active, schedule-enabled templates. These are the ones that can still send. */
  templates: ScheduleTemplate[];
  /** Templates that are no longer active, used only to label a run that already happened. */
  historyTemplates?: ScheduleTemplate[];
  event: ScheduleEventFacts;
  runs: ScheduleRun[];
  directory: RecipientDirectory;
  commsPaused: boolean;
  timeZone: string;
  now?: Date;
}): ScheduledCommItem[] {
  const timeZone = input.timeZone || "America/New_York";
  const { date: today, time: nowTime } = zonedParts(input.now ?? new Date(), timeZone);
  const earliest = addDays(today, -RECENT_DAYS);
  const byId = new Map<string, ScheduleTemplate>();
  for (const template of [...(input.historyTemplates ?? []), ...input.templates]) byId.set(template.id, template);
  const items: ScheduledCommItem[] = [];
  const seen = new Set<string>();

  for (const template of input.templates) {
    if (!templateMatchesEvent(template, input.event)) continue;
    const targetDate = targetDateFor(template, input.event);
    if (!targetDate || targetDate < earliest) continue;
    const run = input.runs.find((r) => r.templateId === template.id && r.targetDate === targetDate);
    const key = `${template.id}:${targetDate}`;
    seen.add(key);
    items.push(itemFrom(template, targetDate, run, input.directory, input.commsPaused, today, nowTime, timeZone));
  }

  for (const run of input.runs) {
    const key = `${run.templateId}:${run.targetDate}`;
    if (seen.has(key) || run.targetDate < earliest) continue;
    const template = byId.get(run.templateId);
    if (!template) continue;
    seen.add(key);
    items.push(itemFrom(template, run.targetDate, run, input.directory, input.commsPaused, today, nowTime, timeZone));
  }

  items.sort((a, b) => {
    if (a.section !== b.section) return a.section === "upcoming" ? -1 : 1;
    const byDate = a.section === "upcoming" ? a.targetDate.localeCompare(b.targetDate) : b.targetDate.localeCompare(a.targetDate);
    if (byDate !== 0) return byDate;
    return a.templateName.localeCompare(b.templateName);
  });
  return items;
}

/** Snake-case template row from email_templates, narrowed to what the list needs. */
export type TemplateRow = {
  id: string;
  name: string | null;
  display_name: string | null;
  is_sms: boolean | null;
  subject: string | null;
  body_html: string | null;
  is_raw_html: boolean | null;
  schedule_days: number | null;
  schedule_direction: string | null;
  schedule_anchor: string | null;
  schedule_send_time: string | null;
  sched_status_ids: string[] | null;
  sched_event_type_ids: string[] | null;
  sched_packages_mode: string | null;
  sched_package_ids: string[] | null;
  sched_addons_mode: string | null;
  sched_addon_ids: string[] | null;
  sched_payments: string | null;
  sched_salesperson_mode: string | null;
  sched_salesperson_ids: string[] | null;
  sched_employee_mode: string | null;
  sched_employee_ids: string[] | null;
  sched_send_to: string[] | null;
  sched_exclude_declined: boolean | null;
  sched_also_send_to: string | null;
  sched_vendor_category_ids: string[] | null;
};

export function mapTemplate(row: TemplateRow): ScheduleTemplate | null {
  if (row.schedule_days == null) return null;
  return {
    id: row.id,
    name: row.name ?? "",
    displayName: row.display_name,
    isSms: !!row.is_sms,
    subject: row.subject ?? "",
    bodyHtml: row.body_html ?? "",
    isRawHtml: !!row.is_raw_html,
    scheduleDays: row.schedule_days,
    scheduleDirection: row.schedule_direction === "after" ? "after" : "before",
    scheduleAnchor: row.schedule_anchor ?? "event_date",
    scheduleSendTime: normalizeTime(row.schedule_send_time),
    schedStatusIds: row.sched_status_ids ?? [],
    schedEventTypeIds: row.sched_event_type_ids ?? [],
    schedPackagesMode: row.sched_packages_mode ?? "all",
    schedPackageIds: row.sched_package_ids ?? [],
    schedAddonsMode: row.sched_addons_mode ?? "all",
    schedAddonIds: row.sched_addon_ids ?? [],
    schedPayments: row.sched_payments ?? "any",
    schedSalespersonMode: row.sched_salesperson_mode ?? "any",
    schedSalespersonIds: row.sched_salesperson_ids ?? [],
    schedEmployeeMode: row.sched_employee_mode ?? "any",
    schedEmployeeIds: row.sched_employee_ids ?? [],
    schedSendTo: row.sched_send_to ?? [],
    schedExcludeDeclined: !!row.sched_exclude_declined,
    schedAlsoSendTo: row.sched_also_send_to,
    schedVendorCategoryIds: row.sched_vendor_category_ids ?? [],
  };
}

export type RunRow = {
  template_id: string;
  target_date: string;
  status: string | null;
  sent_at: string | null;
  acted_by_name: string | null;
  acted_at: string | null;
  override_subject: string | null;
  override_body_html: string | null;
  override_is_raw_html: boolean | null;
  edited_by_name: string | null;
  edited_at: string | null;
};

export const SCHEDULE_TEMPLATE_COLUMNS =
  "id, name, display_name, is_sms, subject, body_html, is_raw_html, schedule_days, schedule_direction, schedule_anchor, schedule_send_time, sched_status_ids, sched_event_type_ids, sched_packages_mode, sched_package_ids, sched_addons_mode, sched_addon_ids, sched_payments, sched_salesperson_mode, sched_salesperson_ids, sched_employee_mode, sched_employee_ids, sched_send_to, sched_exclude_declined, sched_also_send_to, sched_vendor_category_ids";

export const SCHEDULE_RUN_COLUMNS =
  "template_id, target_date, status, sent_at, acted_by_name, acted_at, override_subject, override_body_html, override_is_raw_html, edited_by_name, edited_at";

export function mapRun(row: RunRow): ScheduleRun {
  const status: ScheduleRunStatus =
    row.status === "pending" || row.status === "skipped" || row.status === "marked_sent" || row.status === "sent"
      ? row.status
      : "sent";
  return {
    templateId: row.template_id,
    targetDate: row.target_date.slice(0, 10),
    status,
    sentAt: row.sent_at,
    actedByName: row.acted_by_name,
    actedAt: row.acted_at,
    overrideSubject: row.override_subject,
    overrideBodyHtml: row.override_body_html,
    overrideIsRawHtml: row.override_is_raw_html,
    editedByName: row.edited_by_name,
    editedAt: row.edited_at,
  };
}
