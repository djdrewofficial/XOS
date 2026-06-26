import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { updateTemplate } from "../actions";
import Tabs from "@/components/Tabs";
import SaveButton from "@/components/SaveButton";
import RichTextEditor from "@/components/RichTextEditor";
import { Section, Row, Note, CheckBoxField, CheckGroup } from "@/components/SettingsForm";
import { RadioChecklist, EnabledToggle } from "@/components/HelperEditorControls";
import { templateReviewReasons } from "@/lib/emailTemplateReview";

export const dynamic = "force-dynamic";

const ANCHORS = [
  ["event_date", "Event Date"],
  ["booked_date", "Date Booked"],
  ["initial_contact_date", "Initial Contact Date"],
  ["contract_sent_date", "Contract Sent Date"],
  ["contract_due_date", "Contract Due Date"],
  ["contract_signed_date", "Contract Signed Date"],
  ["quote_sent_date", "Quote Sent Date"],
] as const;

const AUTOFILL_TO = [
  { value: "primary_client", label: "Primary Client" },
  { value: "additional_clients", label: "Additional Clients" },
  { value: "employees", label: "Employees" },
  { value: "salesperson", label: "Salesperson" },
  { value: "administrator", label: "Administrator" },
  { value: "vendors", label: "Vendors" },
  { value: "venue", label: "Venue" },
  { value: "logged_employee", label: "Logged On Employee" },
];

const SCHED_TO = [
  { value: "primary_client", label: "Primary Client" },
  { value: "additional_clients", label: "Additional Clients" },
  { value: "venue", label: "Venue" },
  { value: "vendors", label: "Vendors" },
  { value: "all_employees", label: "All Assigned Employees" },
  { value: "primary_employee", label: "Primary Employee" },
  { value: "unconfirmed_employees", label: "Employees That Have Not Confirmed" },
  { value: "master_admin", label: "Master Administrator" },
  { value: "salesperson", label: "Salesperson" },
];

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: tpl },
    { data: statuses },
    { data: eventTypes },
    { data: packages },
    { data: addons },
    { data: employees },
    { data: helpers },
    { data: vendorCategories },
    { data: docTemplates },
  ] = await Promise.all([
    supabase.from("email_templates").select("*").eq("id", id).single(),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("packages").select("id, name").eq("is_active", true).order("name"),
    supabase.from("addons").select("id, name").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("booking_helpers").select("id, title").order("position"),
    supabase.from("vendor_categories").select("id, name").eq("is_active", true).order("name"),
    supabase.from("document_templates").select("id, name, doc_type").eq("is_active", true).order("name"),
  ]);

  if (!tpl) notFound();

  const isSms = !!tpl.is_sms;
  const reviewReasons = templateReviewReasons(tpl);

  const statusItems = (statuses ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color, text_color: s.text_color }));
  const typeItems = (eventTypes ?? []).map((t) => ({ id: t.id, name: t.name }));
  const employeeOptions = (employees ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }));

  const StatusSelect = ({ name, value }: { name: string; value?: string | null }) => (
    <select name={name} defaultValue={value ?? ""} className="input w-full">
      <option value="">(don&apos;t change)</option>
      {(statuses ?? []).map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
  const HelperSelect = ({ name, value }: { name: string; value?: string | null }) => (
    <select name={name} defaultValue={value ?? ""} className="input w-full">
      <option value="">(none)</option>
      {(helpers ?? []).map((h) => (
        <option key={h.id} value={h.id}>{h.title}</option>
      ))}
    </select>
  );
  const Checklist = ({
    name,
    items,
    selected,
  }: {
    name: string;
    items: { id: string; name: string }[];
    selected: string[];
  }) => {
    const set = new Set(selected);
    return (
      <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-200 p-2.5 dark:border-white/10">
        <div className="space-y-1">
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name={name} value={it.id} defaultChecked={set.has(it.id)} className="size-4 accent-brand-light" />
              <span className="text-zinc-700 dark:text-zinc-300">{it.name}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  /* ===== CONTENT ===== */
  const contentTab = (
    <div className="space-y-5">
      <Section title="Content">
        {!isSms && (
          <Row label="Subject" hint="(merge tags supported)">
            <input name="subject" defaultValue={tpl.subject ?? ""} className="input w-full" placeholder="Your <event_type> on <event_date_long>" />
          </Row>
        )}
        <Row label="Body">
          <RichTextEditor name="body_html" defaultValue={tpl.body_html ?? ""} />
        </Row>
      </Section>
    </div>
  );

  /* ===== SETTINGS ===== */
  const settingsTab = (
    <div className="space-y-5">
      <Section title="Display Name and Category Settings">
        <Row label="Display Name">
          <input name="display_name" defaultValue={tpl.display_name ?? tpl.name} required className="input w-full" />
        </Row>
        <Row label="Campaign Name" hint="Groups templates in the list (e.g. Booked, Leads).">
          <input name="group_name" defaultValue={tpl.group_name ?? "GENERAL"} className="input w-full" list="campaigns" />
          <datalist id="campaigns">
            {["BOOKED", "BOOKING AGREEMENT", "LEADS", "EMPLOYEES", "GENERAL"].map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Row>
        <Row label="Status">
          <CheckBoxField name="is_active" label="Active" defaultChecked={tpl.is_active} />
        </Row>
        {!isSms && (
          <Row
            label="Branded Design"
            hint="ON: logo header + styled card. OFF: plain email exactly as written — better deliverability for follow-ups."
          >
            <CheckBoxField
              name="branded_shell"
              label="Wrap in the branded design (logo header + card)"
              defaultChecked={tpl.branded_shell ?? true}
            />
          </Row>
        )}
      </Section>

      {!isSms && (
      <Section title="Attach Document">
        <Note>
          Attaches a document from the{" "}
          <Link href="/documents" className="font-semibold text-brand underline dark:text-brand-lighter">Document Manager</Link>{" "}
          every time this email sends — from booking helpers, the scheduler, or manual sends.
        </Note>
        <Row label="Document Template">
          <select name="attach_template_id" defaultValue={tpl.attach_template_id ?? ""} className="input w-full max-w-md">
            <option value="">— No document —</option>
            {(docTemplates ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.doc_type})</option>
            ))}
          </select>
        </Row>
        <Row label="Attach As">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="radio" name="attach_mode" value="esign_link" defaultChecked={(tpl.attach_mode ?? "esign_link") === "esign_link"} className="mt-1 accent-brand-light" />
              <span>
                <strong>E-Sign Link</strong> — generates the document for the event at send time and puts the secure
                signing button in the email. Use the <code className="rounded bg-black/5 px-1 dark:bg-white/10">&lt;document_sign_link&gt;</code>{" "}
                merge tag to place the link yourself, or leave it out and a Review &amp; Sign button is added at the bottom.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="radio" name="attach_mode" value="pdf" defaultChecked={tpl.attach_mode === "pdf"} className="mt-1 accent-brand-light" />
              <span>
                <strong>PDF Attachment (no e-sign)</strong> — renders the branded PDF and attaches it. Uses the latest{" "}
                <em>signed</em> copy when one exists (e.g. sending the executed agreement), otherwise generates fresh.
                The PDF is also saved to the event&apos;s files.
              </span>
            </label>
          </div>
        </Row>
        <Note>
          Quote-style merge tags for the body: <code className="rounded bg-black/5 px-1 dark:bg-white/10">&lt;quote_summary&gt;</code>{" "}
          (package + add-ons + Total Investment) and <code className="rounded bg-black/5 px-1 dark:bg-white/10">&lt;payment_plan&gt;</code>.
        </Note>
      </Section>
      )}

      <Section title="Autofill Settings">
        <Note>These settings apply only to manually sent emails — not scheduled emails, notifications, or booking helpers.</Note>
        <Row label="Send To">
          <CheckGroup name="autofill_send_to" options={AUTOFILL_TO} selected={(tpl.autofill_send_to ?? []) as string[]} />
        </Row>
        <Row label="Specific Email Address" hint="(merge tag enabled)">
          <input name="autofill_specific_email" defaultValue={tpl.autofill_specific_email ?? ""} className="input w-full" />
        </Row>
        <Row label="Email Signature">
          <CheckBoxField name="include_signature" label="Include" defaultChecked={tpl.include_signature} />
        </Row>
      </Section>

      <Section title="After Sending This Email Take These Actions">
        <Note>Applies only to manually sent emails.</Note>
        <Row label="Set Event Status To">
          <StatusSelect name="after_set_status_id" value={tpl.after_set_status_id} />
        </Row>
        <Row label="Run This Booking Helper">
          <HelperSelect name="after_run_helper_id" value={tpl.after_run_helper_id} />
        </Row>
      </Section>
    </div>
  );

  /* ===== SCHEDULING ===== */
  const schedulingTab = (
    <div className="space-y-5">
      <Section title="Schedule">
        <Note>Scheduled emails send at the time you set below, in your company timezone. The system checks every 15 minutes.</Note>
        <Row label="When To Send">
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" name="schedule_days" defaultValue={tpl.schedule_days ?? ""} min={0} className="input w-24" placeholder="Days" />
            <span className="text-sm text-zinc-500">days</span>
            <select name="schedule_direction" defaultValue={tpl.schedule_direction ?? "before"} className="input">
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
            <select name="schedule_anchor" defaultValue={tpl.schedule_anchor ?? "event_date"} className="input">
              {ANCHORS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <span className="text-sm text-zinc-500">at</span>
            <input type="time" name="schedule_send_time" defaultValue={(tpl.schedule_send_time ?? "09:00").slice(0, 5)} className="input w-32" />
          </div>
        </Row>
        <Row label="Current Status">
          <EnabledToggle name="schedule_enabled" defaultChecked={tpl.schedule_enabled} />
        </Row>
      </Section>

      <Section title="Event Parameters">
        <Note>The event must match ALL of these for the scheduled email to send.</Note>
        <Row label="Event Status">
          <RadioChecklist name="sched_status_ids" items={statusItems} selected={(tpl.sched_status_ids ?? []) as string[]} allLabel="Any Event Status" onlyLabel="Only These:" />
        </Row>
        <Row label="Event Types">
          <RadioChecklist name="sched_event_type_ids" items={typeItems} selected={(tpl.sched_event_type_ids ?? []) as string[]} allLabel="All Event Types" onlyLabel="Only These:" />
        </Row>
        <Row label="Packages">
          <RadioChecklist name="sched_package_ids" items={(packages ?? []).map((p) => ({ id: p.id, name: p.name }))} selected={(tpl.sched_package_ids ?? []) as string[]} allLabel="All Packages" onlyLabel="Selected Packages" />
        </Row>
        <Row label="Addons">
          <div className="space-y-2">
            <select name="sched_addons_mode" defaultValue={tpl.sched_addons_mode ?? "all"} className="input w-full max-w-xs">
              <option value="all">All Addons</option>
              <option value="assigned">Selected Addons Assigned</option>
              <option value="not_assigned">Selected Addons Not Assigned</option>
            </select>
            <Checklist name="sched_addon_ids" items={(addons ?? []).map((a) => ({ id: a.id, name: a.name }))} selected={(tpl.sched_addon_ids ?? []) as string[]} />
          </div>
        </Row>
        <Row label="By Payments">
          <select name="sched_payments" defaultValue={tpl.sched_payments ?? "any"} className="input w-full max-w-xs">
            <option value="any">Any</option>
            <option value="none">No Payments Made</option>
            <option value="partial">Partially Paid</option>
            <option value="paid_full">Paid In Full</option>
          </select>
        </Row>
        <Row label="Assigned Salesperson">
          <RadioChecklist name="sched_salesperson_ids" items={employeeOptions} selected={(tpl.sched_salesperson_ids ?? []) as string[]} allLabel="Any Salesperson" onlyLabel="Selected Salesperson" />
        </Row>
        <Row label="Assigned Employee">
          <RadioChecklist name="sched_employee_ids" items={employeeOptions} selected={(tpl.sched_employee_ids ?? []) as string[]} allLabel="Any Employee" onlyLabel="Selected Employees" />
        </Row>
      </Section>

      <Section title="Send From">
        <Row label="Send From" hint="Any address on your verified domain; falls back to company if unavailable.">
          <select name="schedule_from" defaultValue={tpl.schedule_from ?? "company"} className="input w-full max-w-xs">
            <option value="company">Company</option>
            <option value="salesperson">Assigned Salesperson</option>
            <option value="primary_dj">Assigned DJ</option>
            <option value="master_admin">Master Administrator</option>
          </select>
        </Row>
      </Section>

      <Section title="Send To">
        <Row label="Send To">
          <CheckGroup name="sched_send_to" options={SCHED_TO} selected={(tpl.sched_send_to ?? []) as string[]} />
        </Row>
        <Row label="Vendor Categories" hint="When “Vendors” is checked: leave empty for all vendors, or pick specific types.">
          <Checklist name="sched_vendor_category_ids" items={(vendorCategories ?? []).map((c) => ({ id: c.id, name: c.name }))} selected={(tpl.sched_vendor_category_ids ?? []) as string[]} />
        </Row>
        <Row label="Exclude Declined Employees">
          <CheckBoxField name="sched_exclude_declined" label="Exclude" defaultChecked={tpl.sched_exclude_declined} />
        </Row>
        <Row label="Also Send To" hint="Extra addresses, comma-separated (merge tag enabled).">
          <input name="sched_also_send_to" defaultValue={tpl.sched_also_send_to ?? ""} className="input w-full" />
        </Row>
      </Section>

      <Section title="Update Event Details">
        <Row label="Set Event Status To">
          <StatusSelect name="sched_set_status_id" value={tpl.sched_set_status_id} />
        </Row>
        <Row label="Run This Booking Helper">
          <HelperSelect name="sched_run_helper_id" value={tpl.sched_run_helper_id} />
        </Row>
      </Section>
    </div>
  );

  /* ===== VISIBILITY ===== */
  const visibilityTab = (
    <div className="space-y-5">
      <Section title="Email Dropdown Display Options">
        <Note>Controls whether this template appears in the manual email-template picker for staff.</Note>
        <Row label="Event Status">
          <RadioChecklist name="vis_status_ids" items={statusItems} selected={(tpl.vis_status_ids ?? []) as string[]} allLabel="All Event Status Values" onlyLabel="Only These:" />
        </Row>
        <Row label="Event Type">
          <RadioChecklist name="vis_event_type_ids" items={typeItems} selected={(tpl.vis_event_type_ids ?? []) as string[]} allLabel="All Event Type Values" onlyLabel="Only These:" />
        </Row>
        <Row label="Packages">
          <RadioChecklist name="vis_package_ids" items={(packages ?? []).map((p) => ({ id: p.id, name: p.name }))} selected={(tpl.vis_package_ids ?? []) as string[]} allLabel="All Packages" onlyLabel="Selected Packages" />
        </Row>
        <Row label="Addons">
          <div className="space-y-2">
            <select name="vis_addons_mode" defaultValue={tpl.vis_addons_mode ?? "all"} className="input w-full max-w-xs">
              <option value="all">All Addons</option>
              <option value="assigned">Selected Addons Assigned</option>
              <option value="not_assigned">Selected Addons Not Assigned</option>
            </select>
            <Checklist name="vis_addon_ids" items={(addons ?? []).map((a) => ({ id: a.id, name: a.name }))} selected={(tpl.vis_addon_ids ?? []) as string[]} />
          </div>
        </Row>
        <Row label="Employee Visibility">
          <select name="employee_visibility" defaultValue={tpl.employee_visibility ?? "admins_salespeople"} className="input w-full max-w-sm">
            <option value="admins_salespeople">Administrators And Salespeople</option>
            <option value="all">All Employees</option>
          </select>
        </Row>
      </Section>

      <Section title="Other Settings">
        <Row label="Inbox Reply Template">
          <CheckBoxField name="is_inbox_reply" label="Request For Information" defaultChecked={tpl.is_inbox_reply} />
        </Row>
        <Row label="Vendor Template">
          <CheckBoxField name="is_vendor_template" label="Include" defaultChecked={tpl.is_vendor_template} />
        </Row>
        <Row label="Venue Template">
          <CheckBoxField name="is_venue_template" label="Include" defaultChecked={tpl.is_venue_template} />
        </Row>
      </Section>
    </div>
  );

  return (
    <div className="max-w-[1700px]">
      <form action={updateTemplate.bind(null, id)}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/settings/email" className="text-xs font-semibold text-zinc-500 hover:underline">
              ← All Email Templates
            </Link>
            <h1 className="page-title mt-1 flex items-center gap-2">
              {isSms ? "Edit SMS Template" : "Edit Email Template"}
              {isSms && (
                <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs font-bold uppercase text-sky-700 dark:text-sky-400">SMS</span>
              )}
            </h1>
            <p className="text-sm text-zinc-500">{tpl.display_name ?? tpl.name}</p>
          </div>
          <SaveButton className="btn-primary px-8">Save</SaveButton>
        </div>

        {reviewReasons.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-bold">⚠ This template needs review before it can be enabled:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {reviewReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">Fix the above and Save — the flag clears automatically.</p>
          </div>
        )}

        <Tabs
          tabs={[
            { id: "content", label: "Content", content: contentTab },
            { id: "settings", label: "Settings", content: settingsTab },
            { id: "scheduling", label: "Scheduling", badge: tpl.schedule_enabled ? "ON" : undefined, content: schedulingTab },
            { id: "visibility", label: "Visibility", content: visibilityTab },
          ]}
        />
      </form>
    </div>
  );
}
