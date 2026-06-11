type Option = { id: string; name: string };
type Status = { id: string; name: string; color: string; text_color: string };

export type HelperDefaults = {
  title?: string;
  button_text?: string;
  button_bg?: string;
  button_fg?: string;
  is_active?: boolean;
  statusId?: string;
  eventTypeId?: string;
  eventName?: string;
  inquirySourceId?: string;
  salespersonId?: string;
  dates?: Map<string, string>;
  customDates?: Map<string, string>;
  templateId?: string;
  note?: string;
  markNotified?: boolean;
  assignEmployeeId?: string;
  assignRole?: string;
  visibleStatusIds?: Set<string>;
  hideIfPaymentMade?: boolean;
  hideIfAlreadyRan?: boolean;
  hideIfHelpersRan?: Set<string>;
  requiredFields?: Set<string>;
};

export const HELPER_DATE_FIELDS = [
  "initial_contact_date",
  "contract_sent_date",
  "contract_due_date",
  "contract_signed_date",
  "quote_sent_date",
  "booked_date",
] as const;

export const REQUIRED_FIELD_OPTIONS = [
  ["event_date", "Event Date"],
  ["setup_time", "Setup Time"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["guest_count", "Guest Count"],
  ["venue", "Venue"],
  ["package", "Package"],
  ["client", "Client"],
  ["client_email", "Client Email"],
  ["client_cell", "Client Cell"],
  ["event_name", "Event Name"],
] as const;

export default function HelperFormFields({
  d,
  statuses,
  templates,
  eventTypes,
  sources,
  employees,
  dateDefs,
  otherHelpers,
}: {
  d: HelperDefaults;
  statuses: Status[];
  templates: { id: string; name: string; group_name: string }[];
  eventTypes: Option[];
  sources: Option[];
  employees: Option[];
  dateDefs: Option[];
  otherHelpers: { id: string; title: string }[];
}) {
  return (
    <div className="space-y-6">
      {/* appearance */}
      <div>
        <h2 className="card-title">Appearance</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="label-xs">Title</label>
            <input name="title" defaultValue={d.title ?? ""} required className="input w-full" />
          </div>
          <div className="md:col-span-2">
            <label className="label-xs">Button Text</label>
            <input name="button_text" defaultValue={d.button_text ?? ""} placeholder="defaults to title" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Button Color</label>
            <input type="color" name="button_bg" defaultValue={d.button_bg ?? "#97CC9A"} className="h-10 w-full cursor-pointer rounded-md border border-zinc-300 dark:border-white/10" />
          </div>
          <div>
            <label className="label-xs">Text Color</label>
            <input type="color" name="button_fg" defaultValue={d.button_fg ?? "#000000"} className="h-10 w-full cursor-pointer rounded-md border border-zinc-300 dark:border-white/10" />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="is_active" defaultChecked={d.is_active ?? true} className="size-4 accent-brand-light" />
            Active
          </label>
        </div>
      </div>

      {/* status + event details */}
      <div>
        <h2 className="card-title">Actions — Status &amp; Event Details</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-xs">Set Event Status To</label>
            <select name="action_status_id" defaultValue={d.statusId ?? ""} className="input w-full">
              <option value="">(don&apos;t change)</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Set Event Type To</label>
            <select name="action_event_type_id" defaultValue={d.eventTypeId ?? ""} className="input w-full">
              <option value="">(don&apos;t change)</option>
              {eventTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Change Event Name To (merge tags OK)</label>
            <input name="action_event_name" defaultValue={d.eventName ?? ""} placeholder='e.g. "<first_name>&apos;s <event_type>"' className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Set Inquiry Source To</label>
            <select name="action_inquiry_source_id" defaultValue={d.inquirySourceId ?? ""} className="input w-full">
              <option value="">(don&apos;t change)</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* dates */}
      <div>
        <h2 className="card-title">Actions — Set Dates</h2>
        <p className="mb-2 text-xs text-zinc-500">Use &quot;today&quot;, &quot;+7&quot; (days from today), or a specific date.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {HELPER_DATE_FIELDS.map((f) => (
            <div key={f}>
              <label className="label-xs">{f.replace(/_/g, " ")}</label>
              <input name={`date_${f}`} defaultValue={d.dates?.get(f) ?? ""} placeholder='"today" or "+7"' className="input w-full" />
            </div>
          ))}
          {dateDefs.map((def) => (
            <div key={def.id}>
              <label className="label-xs">{def.name} (custom)</label>
              <input name={`customdate_${def.id}`} defaultValue={d.customDates?.get(def.id) ?? ""} placeholder='"today" or "+7"' className="input w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* people */}
      <div>
        <h2 className="card-title">Actions — Salesperson &amp; Staff</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label-xs">Change Salesperson To</label>
            <select name="action_salesperson_id" defaultValue={d.salespersonId ?? ""} className="input w-full">
              <option value="">(don&apos;t change)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Assign This Employee</label>
            <select name="action_assign_employee_id" defaultValue={d.assignEmployeeId ?? ""} className="input w-full">
              <option value="">(don&apos;t assign)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">…With Role</label>
            <input name="action_assign_role" defaultValue={d.assignRole ?? "DJ"} className="input w-full" />
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" name="action_mark_notified" defaultChecked={d.markNotified ?? false} className="size-4 accent-brand-light" />
          Mark all assigned employees as notified
        </label>
      </div>

      {/* communication */}
      <div>
        <h2 className="card-title">Actions — Email &amp; Notes</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-xs">Send Email Template To Client</label>
            <select name="action_template_id" defaultValue={d.templateId ?? ""} className="input w-full">
              <option value="">(don&apos;t send email)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.group_name} — {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Add Note (merge tags OK)</label>
            <input name="action_note" defaultValue={d.note ?? ""} className="input w-full" />
          </div>
        </div>
      </div>

      {/* validation */}
      <div>
        <h2 className="card-title">Validation — Required Before Running</h2>
        <p className="mb-2 text-xs text-zinc-500">
          If any checked field is blank on the event, the helper refuses to run and tells you what&apos;s missing.
        </p>
        <div className="flex flex-wrap gap-2">
          {REQUIRED_FIELD_OPTIONS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 rounded border border-zinc-200 dark:border-white/10 px-2 py-1 text-xs">
              <input type="checkbox" name="required_fields" value={key} defaultChecked={d.requiredFields?.has(key) ?? false} className="accent-brand-light" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* visibility */}
      <div>
        <h2 className="card-title">Visibility Conditions</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {statuses.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 dark:border-white/10 px-2 py-1 text-xs">
              <input type="checkbox" name="visible_status_ids" value={s.id} defaultChecked={d.visibleStatusIds?.has(s.id) ?? false} className="accent-brand-light" />
              <span className="rounded px-1.5 py-0.5 font-semibold" style={{ backgroundColor: s.color, color: s.text_color }}>
                {s.name}
              </span>
            </label>
          ))}
        </div>
        <p className="mb-3 text-xs text-zinc-500">Leave all unchecked = visible for every status.</p>
        <div className="mb-3 flex flex-wrap gap-5 text-sm text-zinc-600 dark:text-zinc-400">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="hide_if_payment_made" defaultChecked={d.hideIfPaymentMade ?? false} className="size-4 accent-brand-light" />
            Hide if a payment has been made
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="hide_if_already_ran" defaultChecked={d.hideIfAlreadyRan ?? false} className="size-4 accent-brand-light" />
            Only run once per event
          </label>
        </div>
        {otherHelpers.length > 0 && (
          <>
            <h3 className="label-xs">Hide If Any Of These Helpers Have Already Run</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {otherHelpers.map((h) => (
                <label key={h.id} className="flex items-center gap-2 rounded border border-zinc-200 dark:border-white/10 px-2 py-1.5 text-xs">
                  <input type="checkbox" name="hide_if_helpers_ran" value={h.id} defaultChecked={d.hideIfHelpersRan?.has(h.id) ?? false} className="accent-brand-light" />
                  {h.title}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
