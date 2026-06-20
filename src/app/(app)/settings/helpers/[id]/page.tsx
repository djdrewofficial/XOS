import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { updateHelper } from "../actions";
import Tabs from "@/components/Tabs";
import SaveButton from "@/components/SaveButton";
import { ButtonSettingsRows, RadioChecklist, EnabledToggle } from "@/components/HelperEditorControls";

export const dynamic = "force-dynamic";

type HelperAction = {
  type: string;
  status_id?: string;
  event_type_id?: string;
  inquiry_source_id?: string;
  employee_id?: string;
  role?: string;
  definition_id?: string;
  field?: string;
  value?: string;
  template_id?: string;
  to?: string;
  from?: string;
  address?: string;
  audience?: string;
  body?: string;
  minutes?: string;
  helper_id?: string;
  number?: string;
};

const DATE_FIELDS = [
  ["initial_contact_date", "Initial Contact Date"],
  ["contract_sent_date", "Contract Sent Date"],
  ["contract_due_date", "Contract Due Date"],
  ["booked_date", "Date Booked"],
  ["contract_signed_date", "Contract Signed"],
  ["quote_sent_date", "Quote Sent"],
] as const;

const REQUIRED_EVENT_FIELDS = [
  ["event_date", "Event Date"],
  ["setup_time", "Setup Time"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["guest_count", "Guest Count"],
  ["venue", "Venue"],
  ["package", "Package"],
  ["event_name", "Event Name"],
] as const;

const REQUIRED_CLIENT_FIELDS = [
  ["client", "Client"],
  ["client_email", "Email"],
  ["client_cell", "Cell Phone"],
] as const;

const DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90];

/* ===== DJEP-style layout pieces: section header bar + label-left rows ===== */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold tracking-wide text-white">
        {title.toUpperCase()}
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-white/[0.05]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3.5 md:grid-cols-[280px_1fr] md:items-center">
      <div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="bg-zinc-100 px-4 py-2 text-center text-xs text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-400">
      {children}
    </div>
  );
}

function CheckBoxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-300 bg-zinc-50 px-3.5 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-brand-light" />
      {label}
    </label>
  );
}

function DateSelect({ name, value }: { name: string; value?: string }) {
  const isKnown =
    !value ||
    value === "today" ||
    (value.startsWith("+") && DAY_OPTIONS.includes(parseInt(value.slice(1), 10)));
  return (
    <select name={name} defaultValue={value ?? ""} className="input w-full">
      <option value="">(don&apos;t change)</option>
      <option value="today">Current Date</option>
      {DAY_OPTIONS.map((n) => (
        <option key={n} value={`+${n}`}>
          {n} Day{n > 1 ? "s" : ""} After Current Date
        </option>
      ))}
      {!isKnown && <option value={value}>{value}</option>}
    </select>
  );
}

export default async function EditHelperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: helper },
    { data: statuses },
    { data: templates },
    { data: allHelpers },
    { data: eventTypes },
    { data: sources },
    { data: employees },
    { data: dateDefs },
    { data: planningTemplates },
  ] = await Promise.all([
    supabase.from("booking_helpers").select("*").eq("id", id).single(),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("email_templates").select("id, name, group_name").eq("is_active", true).order("group_name"),
    supabase.from("booking_helpers").select("id, title").neq("id", id).order("position"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("custom_date_definitions").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("planning_templates").select("id, name").eq("is_library", false).order("name"),
  ]);

  if (!helper) notFound();

  const actions = (helper.actions ?? []) as HelperAction[];
  const find = (type: string) => actions.find((a) => a.type === type);
  const emailActions = actions.filter((a) => a.type === "send_email");
  const clientEmail = emailActions.find((a) => a.to !== "custom");
  const customEmail = emailActions.find((a) => a.to === "custom");
  const staffEmail = find("send_email_staff");
  const smsActions = actions.filter((a) => a.type === "send_sms");
  const clientSms = smsActions.find((a) => a.to !== "custom");
  const customSms = smsActions.find((a) => a.to === "custom");
  const assignAction = find("assign_employee");
  const dates = new Map(actions.filter((a) => a.type === "set_date" && a.field).map((a) => [a.field!, a.value ?? ""]));
  const customDates = new Map(
    actions.filter((a) => a.type === "set_custom_date" && a.definition_id).map((a) => [a.definition_id!, a.value ?? ""])
  );
  const times = new Map(actions.filter((a) => a.type === "set_time" && a.field).map((a) => [a.field!, a.value ?? ""]));
  const blocking = new Set((helper.hide_if_helpers_ran ?? []) as string[]);
  const required = new Set((helper.required_fields ?? []) as string[]);

  const employeeOptions = (employees ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }));
  const statusItems = (statuses ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color, text_color: s.text_color }));

  const TemplateSelect = ({ name, value }: { name: string; value?: string }) => (
    <select name={name} defaultValue={value ?? ""} className="input w-full">
      <option value="">(none)</option>
      {(templates ?? []).map((t) => (
        <option key={t.id} value={t.id}>{t.group_name} — {t.name}</option>
      ))}
    </select>
  );

  /* ================= TAB: GENERAL ================= */
  const generalTab = (
    <div className="space-y-5">
      <Section title="Appearance">
        <Row label="Title of Booking Helper">
          <input name="title" defaultValue={helper.title} required className="input w-full" />
        </Row>
        <Row label="Description">
          <textarea name="description" defaultValue={helper.description ?? ""} rows={3} className="input w-full" />
        </Row>
        <Row label="Active" hint="Inactive helpers never appear on events.">
          <CheckBoxField name="is_active" label="Active" defaultChecked={helper.is_active} />
        </Row>
      </Section>

      <Section title="Button Settings">
        <ButtonSettingsRows
          d={{
            button_text: helper.button_text,
            button_bg: helper.button_bg,
            button_fg: helper.button_fg,
            button_font_size: helper.button_font_size ?? 16,
            button_font_weight: helper.button_font_weight ?? 900,
          }}
        />
      </Section>

      <Section title="Event Visibility">
        <Row label="Show For Events With An Event Status Of">
          <RadioChecklist
            name="visible_status_ids"
            items={statusItems}
            selected={(helper.visible_status_ids ?? []) as string[]}
            allLabel="All Event Status Values"
            onlyLabel="Only These Event Status Values:"
          />
        </Row>
        <Row label="If At Least One Payment Has Been Made">
          <CheckBoxField name="hide_if_payment_made" label="Hide" defaultChecked={helper.hide_if_payment_made} />
        </Row>
        <Row label="If This Booking Helper Has Previously Run For Event">
          <CheckBoxField name="hide_if_already_ran" label="Hide" defaultChecked={helper.hide_if_already_ran} />
        </Row>
        {(allHelpers ?? []).length > 0 && (
          <Row label="Hide If Any Of These Other Booking Helpers Have Previously Run For Event">
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 p-2.5 dark:border-white/10">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {(allHelpers ?? []).map((h) => (
                  <label
                    key={h.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
                  >
                    <input
                      type="checkbox"
                      name="hide_if_helpers_ran"
                      value={h.id}
                      defaultChecked={blocking.has(h.id)}
                      className="size-3.5 shrink-0 accent-brand-light"
                    />
                    <span className="truncate">{h.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </Row>
        )}
      </Section>

      <Section title="Secondary Booking Helper">
        <Note>This setting applies to manually triggered Booking Helpers only.</Note>
        <Row label="Run This Booking Helper" hint="Runs immediately after this one finishes.">
          <select name="secondary_helper_id" defaultValue={find("run_helper")?.helper_id ?? ""} className="input w-full">
            <option value="">(none)</option>
            {(allHelpers ?? []).map((h) => (
              <option key={h.id} value={h.id}>{h.title}</option>
            ))}
          </select>
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: EVENT DETAILS ================= */
  const eventDetailsTab = (
    <div className="space-y-5">
      <Section title="Event Details">
        <Row label="Set Event Status To">
          <select name="action_status_id" defaultValue={find("set_status")?.status_id ?? ""} className="input w-full">
            <option value="">(don&apos;t change)</option>
            {(statuses ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Row>
        <Row label="Set Event Type To">
          <select name="action_event_type_id" defaultValue={find("set_event_type")?.event_type_id ?? ""} className="input w-full">
            <option value="">(don&apos;t change)</option>
            {(eventTypes ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Row>
        <Row label="Change Event Name To" hint="(merge tag enabled)">
          <input name="action_event_name" defaultValue={find("set_event_name")?.value ?? ""} placeholder='"<first_name>&apos;s <event_type>"' className="input w-full" />
        </Row>
        <Row label="Set Inquiry Source To">
          <select name="action_inquiry_source_id" defaultValue={find("set_inquiry_source")?.inquiry_source_id ?? ""} className="input w-full">
            <option value="">(don&apos;t change)</option>
            {(sources ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Internal Note">
        <Row label="Add Internal Note" hint="(merge tag enabled)">
          <input name="action_note" defaultValue={find("add_note")?.body ?? ""} className="input w-full" />
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: SEND EMAILS ================= */
  const emailsTab = (
    <div className="space-y-5">
      <div className="rounded-lg bg-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-400">
        Emails are queued to the outbox and sent from the company email address via Mailgun. Every send is logged on the event.
      </div>
      <Section title="Send Email To Related Contact">
        <Row label="Client">
          <TemplateSelect name="action_template_id" value={clientEmail?.template_id} />
        </Row>
        <Row label="Send As" hint="Salesperson/DJ must have an address on your verified domain; otherwise falls back to company.">
          <select name="action_email_from" defaultValue={clientEmail?.from ?? "company"} className="input w-full max-w-xs">
            <option value="company">Company (default)</option>
            <option value="salesperson">Assigned Salesperson</option>
            <option value="primary_dj">Assigned DJ</option>
          </select>
        </Row>
      </Section>
      <Section title="Send Email To Specific Email Address">
        <Row label="Email Address">
          <input type="email" name="email_custom_address" defaultValue={customEmail?.address ?? ""} className="input w-full" placeholder="venue@example.com" />
        </Row>
        <Row label="Send This Email">
          <TemplateSelect name="email_custom_template_id" value={customEmail?.template_id} />
        </Row>
      </Section>
      <Section title="Send Email To Employees">
        <Row label="Send To">
          <select name="staff_email_audience" defaultValue={staffEmail?.audience ?? ""} className="input w-full">
            <option value="">(don&apos;t send)</option>
            <option value="all">Assigned Employees (All Employees)</option>
            <option value="not_notified">Assigned Employees (Not Marked As Notified)</option>
            <option value="not_confirmed">Assigned Employees (Not Confirmed Or Declined)</option>
            <option value="salesperson">Salesperson</option>
          </select>
        </Row>
        <Row label="Send This Email">
          <TemplateSelect name="staff_email_template_id" value={staffEmail?.template_id} />
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: SEND TEXTS ================= */
  const textsTab = (
    <div className="space-y-5">
      <div className="rounded-lg bg-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-400">
        Texts are queued to the outbox and sent through HighLevel — the conversation (including replies) appears in
        your HighLevel inbox. Merge tags work in message bodies. Every send is logged on the event.
      </div>
      <Section title="Send Text Message To Client">
        <Row label="Message" hint="(merge tag enabled) Sent to the client's cell phone — skipped if blank.">
          <textarea
            name="action_sms_body"
            defaultValue={clientSms?.body ?? ""}
            rows={4}
            className="input w-full"
            placeholder={'e.g. "Hi <first_name>! Your <event_type> on <event_date_long> is officially booked 🎉"'}
          />
        </Row>
      </Section>
      <Section title="Send Text Message To Specific Number">
        <Row label="Phone Number">
          <input
            type="tel"
            name="sms_custom_number"
            defaultValue={customSms?.number ?? ""}
            className="input w-full max-w-xs"
            placeholder="(305) 555-1234"
          />
        </Row>
        <Row label="Message" hint="(merge tag enabled)">
          <textarea name="sms_custom_body" defaultValue={customSms?.body ?? ""} rows={4} className="input w-full" />
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: DATES / TIMES ================= */
  const datesTab = (
    <div className="space-y-5">
      <Section title="Set Dates">
        {DATE_FIELDS.map(([field, label]) => (
          <Row key={field} label={label}>
            <DateSelect name={`date_${field}`} value={dates.get(field)} />
          </Row>
        ))}
        {(dateDefs ?? []).map((def) => (
          <Row key={def.id} label={def.name} hint="(custom date)">
            <DateSelect name={`customdate_${def.id}`} value={customDates.get(def.id)} />
          </Row>
        ))}
      </Section>

      <Section title="Set Times">
        <Row label="Change Setup Time To:" hint="(Start Time Minus X Minutes)">
          <div className="flex items-center">
            <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-2.5 text-sm text-zinc-500 dark:border-white/10 dark:bg-white/[0.06]">#</span>
            <input
              type="number"
              name="setup_before_start_minutes"
              defaultValue={find("setup_before_start")?.minutes ?? ""}
              className="h-9 w-36 rounded-r-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100"
              placeholder="e.g. 90"
            />
          </div>
        </Row>
        <Row label="Change Setup Time To:" hint="(Enter Exact Time)">
          <input type="time" name="time_setup_time" defaultValue={times.get("setup_time") ?? ""} className="input w-44" />
        </Row>
        <Row label="Change Start Time To:" hint="(Enter Exact Time)">
          <input type="time" name="time_start_time" defaultValue={times.get("start_time") ?? ""} className="input w-44" />
        </Row>
        <Row label="Change End Time To:" hint="(Enter Exact Time)">
          <input type="time" name="time_end_time" defaultValue={times.get("end_time") ?? ""} className="input w-44" />
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: EMPLOYEES ================= */
  const employeesTab = (
    <div className="space-y-5">
      <Section title="Salesperson">
        <Row label="Change Salesperson To">
          <select name="action_salesperson_id" defaultValue={find("set_salesperson")?.employee_id ?? ""} className="input w-full">
            <option value="">(don&apos;t change)</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Assign Employee">
        <Row label="Assign This Employee">
          <select name="action_assign_employee_id" defaultValue={assignAction?.employee_id ?? ""} className="input w-full">
            <option value="">(don&apos;t assign)</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Row>
        <Row label="With Role">
          <input name="action_assign_role" defaultValue={assignAction?.role ?? "DJ"} className="input w-full max-w-xs" />
        </Row>
        <Row label="Notifications">
          <CheckBoxField
            name="action_mark_notified"
            label="Mark all assigned employees as notified"
            defaultChecked={!!find("mark_staff_notified")}
          />
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: AUTOMATION ================= */
  const automationTab = (
    <div className="space-y-5">
      <Section title="When Adding A New Event">
        <Note>
          This setting will trigger this booking helper immediately after an event is added with the following parameters.
        </Note>
        <Row label="Status">
          <EnabledToggle name="auto_on_create" defaultChecked={helper.auto_on_create} />
        </Row>
        <Row label="Event Status">
          <RadioChecklist
            name="auto_status_ids"
            items={statusItems}
            selected={(helper.auto_status_ids ?? []) as string[]}
            allLabel="Any Event Status"
            onlyLabel="Only These Event Status Values:"
          />
        </Row>
        <Note>
          If the auto-run fails (e.g. validation requires fields the new event doesn&apos;t have), the failure is recorded in
          the event&apos;s log instead of blocking the event.
        </Note>
      </Section>

      <Section title="Lifecycle Triggers">
        <Note>
          Run this helper automatically at these moments in the client journey. Combine with the one-shot setting in
          Visibility so it only fires once per event.
        </Note>
        <Row label="When the proposal is confirmed">
          <EnabledToggle name="auto_on_proposal_confirmed" defaultChecked={helper.auto_on_proposal_confirmed ?? false} />
        </Row>
        <Row label="When the contract is signed">
          <EnabledToggle name="auto_on_signed" defaultChecked={helper.auto_on_signed ?? false} />
        </Row>
        <Row label="When a payment is received">
          <EnabledToggle name="auto_on_payment" defaultChecked={helper.auto_on_payment ?? false} />
        </Row>
        <Row label="Only for these event types">
          <RadioChecklist
            name="event_type_ids"
            items={(eventTypes ?? []).map((t) => ({ id: t.id, name: t.name }))}
            selected={(helper.event_type_ids ?? []) as string[]}
            allLabel="All event types"
            onlyLabel="Only these event types:"
          />
        </Row>
      </Section>

      <Section title="Webhook (Zapier)">
        <Note>
          After this helper runs, POST the event details to this URL — use it to trigger a Zapier zap (create the Vibo
          event, a Google Drive folder, etc.). Leave blank for none.
        </Note>
        <Row label="Webhook URL">
          <input
            name="webhook_url"
            type="url"
            defaultValue={helper.webhook_url ?? ""}
            placeholder="https://hooks.zapier.com/…"
            className="input w-full"
          />
        </Row>
      </Section>

      <Section title="XOS Planner Template">
        <Note>
          When this helper runs, assign this planning template to the event (sets up the couple&apos;s music &amp;
          timeline sections). Applied once — it won&apos;t overwrite an event that already uses this template.
          Manage templates in <strong>Settings → XOS Planner</strong>.
        </Note>
        <Row label="Assign template">
          <select name="planning_template_id" defaultValue={helper.planning_template_id ?? ""} className="input w-full">
            <option value="">— None —</option>
            {(planningTemplates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </div>
  );

  /* ================= TAB: VALIDATION ================= */
  const validationTab = (
    <div className="space-y-5">
      <div className="rounded-lg bg-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-400">
        This feature allows you to select which fields require a value before the booking helper can run. If a selected
        field is blank, the helper refuses to run and lists what&apos;s missing.
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Event Based Fields">
          <div className="space-y-1.5 p-3">
            {REQUIRED_EVENT_FIELDS.map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
              >
                <input type="checkbox" name="required_fields" value={key} defaultChecked={required.has(key)} className="size-4 accent-brand-light" />
                {label}
              </label>
            ))}
          </div>
        </Section>
        <Section title="Client Based Fields">
          <div className="space-y-1.5 p-3">
            {REQUIRED_CLIENT_FIELDS.map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
              >
                <input type="checkbox" name="required_fields" value={key} defaultChecked={required.has(key)} className="size-4 accent-brand-light" />
                {label}
              </label>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl">
      <form action={updateHelper.bind(null, id)}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/settings/helpers" className="text-xs font-semibold text-zinc-500 hover:underline">
              ← All Booking Helpers
            </Link>
            <h1 className="page-title mt-1">
              Edit Booking Helper <span className="text-zinc-400">#{(helper.position ?? 0) + 1}</span>
            </h1>
            <p className="text-sm text-zinc-500">{helper.title}</p>
          </div>
          <SaveButton className="btn-primary px-8">Save</SaveButton>
        </div>

        <Tabs
          tabs={[
            { id: "general", label: "General", content: generalTab },
            { id: "details", label: "Event Details", content: eventDetailsTab },
            { id: "emails", label: "Send Emails", content: emailsTab },
            { id: "texts", label: "Send Texts", badge: smsActions.length || undefined, content: textsTab },
            { id: "dates", label: "Dates / Times", content: datesTab },
            { id: "employees", label: "Employees", content: employeesTab },
            { id: "automation", label: "Automation", badge: helper.auto_on_create ? "ON" : undefined, content: automationTab },
            { id: "validation", label: "Validation", badge: required.size || undefined, content: validationTab },
          ]}
        />
      </form>
    </div>
  );
}
