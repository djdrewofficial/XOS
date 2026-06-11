import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Tabs from "@/components/Tabs";
import { Section, Row, Note, CheckBoxField, CheckGroup } from "@/components/SettingsForm";
import { RadioChecklist } from "@/components/HelperEditorControls";
import {
  PERM_SECTIONS,
  PERM_VIEW_CLIENT,
  PERM_VIEW_BOOKING,
  PERM_VIEW_EMPLOYEES,
  PERM_VIEW_OTHER,
  PERM_NOTES,
  PORTAL_FIELDS,
  PAYROLL_EXPORT_FIELDS,
  type StaffSettings,
} from "./constants";
import {
  saveFeatures,
  saveAccess,
  savePermissions,
  saveNotifications,
  savePayroll,
  saveAvailabilitySort,
  saveEmployeeRow,
} from "./actions";

export const dynamic = "force-dynamic";

const TIER_LABELS: Record<string, string> = {
  master_admin: "Master Admin",
  admin: "Admin",
  salesperson: "Salesperson",
  employee: "Employee",
};

function SaveButton() {
  return (
    <div className="mt-4 flex justify-end">
      <button className="btn-primary">Save Settings</button>
    </div>
  );
}

export default async function StaffSettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: statuses }, { data: employees }, { data: templates }] =
    await Promise.all([
      supabase.from("staff_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
      supabase
        .from("employees")
        .select("id, first_name, last_name, permission_tier, hourly_rate, display_order, check_in_required, can_send_as_self")
        .eq("is_active", true)
        .order("display_order", { ascending: false })
        .order("first_name"),
      supabase.from("email_templates").select("id, name").eq("is_active", true).order("name"),
    ]);

  if (!settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Staff Settings</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00027_staff_settings.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = settings as StaffSettings;
  const sec = (k: string, def: boolean) => s.perm_sections?.[k] ?? def;
  const view = (k: string, def: boolean) => s.perm_view?.[k] ?? def;
  const note = (k: string, def: boolean) => s.perm_notes?.[k] ?? def;
  const portal = (k: string, defView: boolean, defEdit: boolean) => ({
    view: s.portal_fields?.[k]?.view ?? defView,
    edit: s.portal_fields?.[k]?.edit ?? defEdit,
  });

  const statusItems = (statuses ?? []).map((st) => ({
    id: st.id,
    name: st.name,
    color: st.color,
    text_color: st.text_color,
  }));
  const employeeItems = (employees ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
  }));

  /* ---------------- FEATURES ---------------- */
  const featuresTab = (
    <form action={saveFeatures} className="space-y-5">
      <Section title="Features">
        <Note>These features apply to staff with basic employee-level access — not Admins or Salespeople.</Note>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <CheckBoxField name="feat_time_off" label="Time Off System" defaultChecked={s.feat_time_off} />
          <CheckBoxField name="feat_confirm_events" label="Confirm Events" defaultChecked={s.feat_confirm_events} />
          <CheckBoxField name="feat_decline_events" label="Decline Events" defaultChecked={s.feat_decline_events} />
          <CheckBoxField name="feat_check_in_out" label="Check In/Out System" defaultChecked={s.feat_check_in_out} />
          <CheckBoxField name="feat_timesheets" label="Submit Hourly Timesheets" defaultChecked={s.feat_timesheets} />
          <CheckBoxField name="feat_wage_report" label="Wage Report" defaultChecked={s.feat_wage_report} />
          <CheckBoxField name="feat_available_events" label="Available Events System" defaultChecked={s.feat_available_events} />
          <CheckBoxField name="feat_event_count" label="Event Count" defaultChecked={s.feat_event_count} />
        </div>
        <Note>
          Check In/Out can also be required per employee — see the Employees tab or the{" "}
          <Link href="/employees" className="font-semibold text-brand underline dark:text-brand-lighter">employee profile</Link>.
        </Note>
      </Section>

      <Section title="Time Off Request Settings">
        <Row label="Requests For Time Off">
          <div className="flex flex-wrap items-center gap-3">
            <select name="time_off_mode" defaultValue={s.time_off_mode} className="input">
              <option value="any">Allow Any Request</option>
              <option value="advance_notice">Require Advance Notice</option>
              <option value="none">Don&apos;t Allow Requests</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Advance notice days
              <input
                type="number"
                name="time_off_advance_days"
                defaultValue={s.time_off_advance_days ?? ""}
                className="input w-24"
                min={0}
              />
            </label>
          </div>
        </Row>
        <Row label="Delete Requests">
          <CheckBoxField name="time_off_allow_delete" label="Allow Employee To Delete Time Off" defaultChecked={s.time_off_allow_delete} />
        </Row>
        <Row label="Auto Approve">
          <CheckBoxField name="time_off_auto_approve" label="Automatically Approve All Time Off Requests" defaultChecked={s.time_off_auto_approve} />
        </Row>
        <Row label="Terminology" hint="The word shown to employees when a request is granted">
          <input name="time_off_terminology" defaultValue={s.time_off_terminology} className="input w-48" />
        </Row>
        <Note>
          Time off requests are managed on each{" "}
          <Link href="/employees" className="font-semibold text-brand underline dark:text-brand-lighter">employee profile</Link>{" "}
          (Time Off tab) — these settings control how the employee portal behaves.
        </Note>
      </Section>

      <Section title="Decline Event Settings">
        <Row label="Decline Reason">
          <CheckBoxField name="decline_requires_reason" label="Require a reason when an employee declines an event" defaultChecked={s.decline_requires_reason} />
        </Row>
        <Note>Declined events stay on the event&apos;s Staff tab so another employee can be assigned.</Note>
      </Section>

      <Section title="Event Count Settings">
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <CheckBoxField name="show_past_event_count" label="Show Count Of Past Events" defaultChecked={s.show_past_event_count} />
          <CheckBoxField name="show_upcoming_event_count" label="Show Count Of Upcoming Events" defaultChecked={s.show_upcoming_event_count} />
        </div>
      </Section>
      <SaveButton />
    </form>
  );

  /* ---------------- ACCESS TO EVENTS ---------------- */
  const accessTab = (
    <form action={saveAccess} className="space-y-5">
      <Section title="Access Based On Status">
        <Row label="Let employees see events with a status of" hint="Statuses are managed in Event Statuses">
          <RadioChecklist
            name="access_status_ids"
            items={statusItems}
            selected={s.access_status_ids ?? []}
            allLabel="All statuses"
            onlyLabel="Only these statuses"
          />
        </Row>
        <Note>
          Add or edit statuses on the{" "}
          <Link href="/settings/statuses" className="font-semibold text-brand underline dark:text-brand-lighter">Event Statuses</Link> page.
        </Note>
      </Section>

      <Section title="Access Based On Time Before Events">
        <Row
          label="Let employees see events this far in advance"
          hint="Leave blank to allow employees to see upcoming events regardless of how far into the future they are"
        >
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="number" name="access_days_before" defaultValue={s.access_days_before ?? ""} className="input w-28" min={0} />
            days
          </label>
        </Row>
      </Section>

      <Section title="Access Based On Time After Events">
        <Row
          label="Let employees see events this far back"
          hint="Leave blank to allow employees to see past events regardless of how far into the past they are"
        >
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="number" name="access_days_after" defaultValue={s.access_days_after ?? ""} className="input w-28" min={0} />
            days
          </label>
        </Row>
      </Section>
      <SaveButton />
    </form>
  );

  /* ---------------- PERMISSIONS ---------------- */
  const permGrid = (
    items: ReadonlyArray<readonly [string, string, boolean]>,
    prefix: string,
    lookup: (k: string, def: boolean) => boolean,
  ) => (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([key, label, def]) => (
        <CheckBoxField key={key} name={`${prefix}_${key}`} label={label} defaultChecked={lookup(key, def)} />
      ))}
    </div>
  );

  const permissionsTab = (
    <form action={savePermissions} className="space-y-5">
      <Note>
        These permissions apply to staff with basic employee-level access. They are not applicable to Admins or
        Salespeople (tiers are set per employee on the Employees tab).
      </Note>
      <Section title="Event Report Information Sections">
        <Note>Check each section you want visible to employees on the Event Report page.</Note>
        {permGrid(PERM_SECTIONS, "sec", sec)}
      </Section>
      <Section title="View Client Information">{permGrid(PERM_VIEW_CLIENT, "view", view)}</Section>
      <Section title="View Booking Information">{permGrid(PERM_VIEW_BOOKING, "view", view)}</Section>
      <Section title="View Other Employees">{permGrid(PERM_VIEW_EMPLOYEES, "view", view)}</Section>
      <Section title="View Other Information">{permGrid(PERM_VIEW_OTHER, "view", view)}</Section>
      <Section title="Add / Edit Event Notes">
        <Row label="Add Event Notes">
          <CheckBoxField name="note_add_post_event_notes" label="Post Event Notes" defaultChecked={note("add_post_event_notes", false)} />
        </Row>
        <Row label="Edit Event Notes">
          <div className="flex flex-wrap gap-2">
            <CheckBoxField name="note_edit_client_notes" label="Client Notes" defaultChecked={note("edit_client_notes", false)} />
            <CheckBoxField name="note_edit_booking_comments" label="Booking Comments" defaultChecked={note("edit_booking_comments", false)} />
          </div>
        </Row>
      </Section>

      <Section title="Employee Portal — Own Profile Fields">
        <Note>
          Controls which of their own profile fields employees can view and edit. They can never edit other
          employees&apos; information.
        </Note>
        <div className="grid gap-x-6 p-4 lg:grid-cols-2">
          {PORTAL_FIELDS.map(([key, label, defView, defEdit]) => {
            const p = portal(key, defView, defEdit);
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 last:border-b-0 dark:border-white/[0.05]"
              >
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
                <span className="flex gap-2">
                  <CheckBoxField name={`portal_view_${key}`} label="View" defaultChecked={p.view} />
                  <CheckBoxField name={`portal_edit_${key}`} label="Edit" defaultChecked={p.edit} />
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      <SaveButton />
    </form>
  );

  /* ---------------- NOTIFICATIONS ---------------- */
  const emailRow = (label: string, name: string, value: string | null) => (
    <Row label={label} hint="Comma-separate multiple addresses. Blank = company email. Enter NONE to disable.">
      <input name={name} defaultValue={value ?? ""} className="input w-full max-w-md" placeholder="office@xpressdjs.com" />
    </Row>
  );

  const notificationsTab = (
    <div className="space-y-8">
      <form action={saveNotifications} className="space-y-5">
        <Section title="System Notifications (To The Office)">
          <Note>
            Emails sent to the office when employees act in the portal. Blank settings go to the company email set in{" "}
            <Link href="/settings/email" className="font-semibold text-brand underline dark:text-brand-lighter">Email Settings</Link>.
          </Note>
          {emailRow("When Employee Requests An Event", "notify_request_event", s.notify_request_event)}
          {emailRow("When An Employee Checks In", "notify_check_in", s.notify_check_in)}
          {emailRow("When An Employee Checks Out", "notify_check_out", s.notify_check_out)}
          {emailRow("When Employee Submits A Time Sheet", "notify_timesheet", s.notify_timesheet)}
          {emailRow("When Employee Requests Time Off", "notify_time_off", s.notify_time_off)}
          {emailRow("When Employee Confirms Or Declines An Event", "notify_confirm_decline", s.notify_confirm_decline)}
          <Row label="Also Send To">
            <CheckBoxField
              name="notify_confirm_also_salesperson"
              label="Assigned Salesperson (confirmations / declines)"
              defaultChecked={s.notify_confirm_also_salesperson}
            />
          </Row>
        </Section>

        <Section title="Assignment Notifications (To Staff)">
          <Note>
            Templates are created on the{" "}
            <Link href="/settings/email" className="font-semibold text-brand underline dark:text-brand-lighter">Email Settings</Link>{" "}
            page — the same template editor used everywhere else.
          </Note>
          <Row label="When an employee is assigned to an event" hint="Send this email template to the employee(s)">
            <select name="assign_employee_template_id" defaultValue={s.assign_employee_template_id ?? ""} className="input w-full max-w-md">
              <option value="">— Don&apos;t send —</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Row>
          <Row label="When a salesperson is assigned to an event" hint="Send this email template to the salesperson">
            <select name="assign_salesperson_template_id" defaultValue={s.assign_salesperson_template_id ?? ""} className="input w-full max-w-md">
              <option value="">— Don&apos;t send —</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Row>
          <Row label="Other Actions">
            <CheckBoxField name="assign_mark_notified" label="Mark Employees As Notified" defaultChecked={s.assign_mark_notified} />
          </Row>
        </Section>

        <Section title="Notification Exclusions">
          <Row label="Do NOT send notifications for these employees">
            <RadioChecklist
              name="notif_exclude_employee_ids"
              items={employeeItems}
              selected={s.notif_exclude_employee_ids ?? []}
              allLabel="No exclusions"
              onlyLabel="Exclude specific employees"
            />
          </Row>
          <Row label="Do NOT send notifications for events with this status">
            <RadioChecklist
              name="notif_exclude_status_ids"
              items={statusItems}
              selected={s.notif_exclude_status_ids ?? []}
              allLabel="No exclusions"
              onlyLabel="Exclude specific statuses"
            />
          </Row>
        </Section>
        <SaveButton />
      </form>
    </div>
  );

  /* ---------------- PAYROLL ---------------- */
  const payrollTab = (
    <form action={savePayroll} className="space-y-5">
      <Section title="Display">
        <Row label="Sort Order For A Given Date">
          <select name="payroll_sort_day" defaultValue={s.payroll_sort_day} className="input">
            <option value="event_type">Event Type</option>
            <option value="event_time">Event Time</option>
            <option value="client_name">Client Name</option>
          </select>
        </Row>
        <Row label="Sort Order Within Event Itself">
          <select name="payroll_sort_event" defaultValue={s.payroll_sort_event} className="input">
            <option value="first_last">First Name, Last Name</option>
            <option value="last_first">Last Name, First Name</option>
            <option value="role">Role</option>
          </select>
        </Row>
        <Row label="Display Employee Name">
          <select name="payroll_name_format" defaultValue={s.payroll_name_format} className="input">
            <option value="first_last">First Name Last Name</option>
            <option value="last_first">Last Name, First Name</option>
            <option value="stage_name">Stage Name</option>
          </select>
        </Row>
      </Section>

      <Section title="Payroll Report Defaults">
        <Row label="Default Start Date" hint="Days before the current date">
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="number" name="payroll_start_offset_days" defaultValue={s.payroll_start_offset_days} className="input w-28" min={0} />
            days before today
          </label>
        </Row>
        <Row label="Default End Date" hint="0 = the current date">
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="number" name="payroll_end_offset_days" defaultValue={s.payroll_end_offset_days} className="input w-28" min={0} />
            days before today
          </label>
        </Row>
        <Note>
          Payroll only includes events whose status counts toward Payroll — set per status on the{" "}
          <Link href="/settings/statuses" className="font-semibold text-brand underline dark:text-brand-lighter">Event Statuses</Link> page.
        </Note>
      </Section>

      <Section title="Export Payroll Report">
        <Note>Choose which fields are included when exporting the payroll report to CSV.</Note>
        <div className="p-4">
          <CheckGroup
            name="payroll_export_fields"
            options={PAYROLL_EXPORT_FIELDS.map(([value, label]) => ({ value, label }))}
            selected={s.payroll_export_fields ?? []}
          />
        </div>
      </Section>
      <SaveButton />
    </form>
  );

  /* ---------------- EMPLOYEES (per-employee, lives in two places) ---------------- */
  const employeesTab = (
    <div className="space-y-8">
      <form action={saveAvailabilitySort}>
        <Section title="Check Availability Sort Method">
          <Row label="Default Display Options" hint="Order employees appear in when checking availability">
            <div className="flex items-center gap-3">
              <select name="availability_sort" defaultValue={s.availability_sort} className="input">
                <option value="display_order">Display Order</option>
                <option value="first_name">First Name</option>
                <option value="last_name">Last Name</option>
              </select>
              <button className="btn-primary px-5 py-1.5 text-xs">Save</button>
            </div>
          </Row>
        </Section>
      </form>

      <div>
        <Section title="Per-Employee Settings">
          <Note>
            These settings also live on each employee&apos;s profile — edit them in either place. Display order: the
            HIGHER the value, the earlier the employee appears in drop-down lists (duplicates are fine).
          </Note>
          <div className="hidden gap-3 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:grid lg:grid-cols-[minmax(160px,1.2fr)_140px_110px_90px_1fr_auto]">
            <span>Employee</span>
            <span>Tier</span>
            <span>Hourly Rate</span>
            <span>Order</span>
            <span>Portal / Email</span>
            <span />
          </div>
          {(employees ?? []).map((e) => (
            <form
              key={e.id}
              action={saveEmployeeRow.bind(null, e.id)}
              className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[minmax(160px,1.2fr)_140px_110px_90px_1fr_auto]"
            >
              <Link
                href={`/employees/${e.id}`}
                className="text-sm font-semibold text-brand hover:underline dark:text-brand-lighter"
              >
                {e.first_name} {e.last_name}
              </Link>
              <select name="permission_tier" defaultValue={e.permission_tier} className="input">
                {Object.entries(TIER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                type="number"
                name="hourly_rate"
                step="0.01"
                defaultValue={e.hourly_rate ?? ""}
                placeholder="$/hr"
                className="input"
              />
              <input type="number" name="display_order" defaultValue={e.display_order ?? 0} className="input" />
              <div className="flex flex-wrap gap-2">
                <CheckBoxField name="check_in_required" label="Check-In Required" defaultChecked={e.check_in_required} />
                <CheckBoxField name="can_send_as_self" label="Send Email As Self" defaultChecked={e.can_send_as_self} />
              </div>
              <button className="btn-primary px-5 py-1.5 text-xs">Save</button>
            </form>
          ))}
          {(employees ?? []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No active employees — add staff on the <Link href="/employees" className="font-semibold text-brand underline dark:text-brand-lighter">Employees</Link> page.
            </p>
          )}
        </Section>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="page-title mb-0">Staff Settings</h1>
        <Link href="/employees" className="btn-ghost px-4 py-1.5 text-xs">
          Manage Employees →
        </Link>
      </div>
      <Tabs
        tabs={[
          { id: "features", label: "Features", content: featuresTab },
          { id: "access", label: "Event Access", content: accessTab },
          { id: "permissions", label: "Permissions", content: permissionsTab },
          { id: "notifications", label: "Notifications", content: notificationsTab },
          { id: "payroll", label: "Payroll", content: payrollTab },
          { id: "employees", label: "Employees", badge: (employees ?? []).length, content: employeesTab },
        ]}
      />
    </div>
  );
}
