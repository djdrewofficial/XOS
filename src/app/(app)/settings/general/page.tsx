import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note, CheckBoxField, CheckGroup } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import Tabs from "@/components/Tabs";
import { saveGeneralSettings } from "./actions";

export const dynamic = "force-dynamic";

const TIMEZONES = [
  ["America/New_York", "Eastern (New York)"],
  ["America/Chicago", "Central (Chicago)"],
  ["America/Denver", "Mountain (Denver)"],
  ["America/Phoenix", "Arizona (no DST)"],
  ["America/Los_Angeles", "Pacific (Los Angeles)"],
] as const;

const NOTIF_TYPES = [
  { value: "pending_timesheets", label: "Pending Timesheets" },
  { value: "assignment_requests", label: "Requests For Assignment To Events" },
  { value: "time_off_requests", label: "Employee Time Off Requests" },
  { value: "unassigned_pending_payments", label: "Unassigned Pending Payments" },
  { value: "new_payment_received", label: "New Payment Received" },
  { value: "zelle_pending", label: "Zelle Marked Sent (confirm & record)" },
  { value: "email_bounced", label: "Bounced / Complained Emails" },
  { value: "document_signed", label: "Document Signed (e-sign)" },
];

const LANDING_PAGES = [
  ["/", "Dashboard"],
  ["/events", "Events List"],
  ["/events/new", "Add Event"],
  ["/clients", "Clients"],
  ["/payments", "Payments"],
] as const;

type GeneralSettings = {
  timezone: string;
  phone_format_enabled: boolean;
  browser_autocomplete: boolean;
  notif_sound: boolean;
  notif_types: string[];
  inbox_show_counter: boolean;
  default_template_event_id: string | null;
  landing_page: string;
};

export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: events }] = await Promise.all([
    supabase.from("company_settings").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_date")
      .order("event_date", { ascending: false })
      .limit(100),
  ]);

  if (!settings || settings.phone_format_enabled === undefined) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">General</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00031_general_settings.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = settings as GeneralSettings;

  return (
    <div className="max-w-5xl">
      <h1 className="page-title mb-5">General</h1>
      <form action={saveGeneralSettings} className="space-y-5">
        <Tabs
          tabs={[
            { id: "general", label: "General", content: (
              <div className="space-y-5">
        <Section title="Time Zone">
          <Row label="Time Zone" hint="Drives scheduled email send times and date handling">
            <select name="timezone" defaultValue={s.timezone ?? "America/New_York"} className="input w-full max-w-md">
              {TIMEZONES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Row>
          <Note>
            Scheduled email templates (set up in{" "}
            <Link href="/settings/email" className="font-semibold text-brand underline dark:text-brand-lighter">Email Settings</Link>)
            send at their configured time in this time zone.
          </Note>
        </Section>

        <Section title="Telephone Numbers">
          <Row label="Phone Formatting" hint="Numbers entered on clients are normalized to 612-555-1212 when saved">
            <CheckBoxField name="phone_format_enabled" label="Format phone numbers when saving" defaultChecked={s.phone_format_enabled} />
          </Row>
        </Section>

        <Section title="Browser Settings">
          <Row
            label="Auto Complete"
            hint="Off by default — keeps the browser from autofilling saved personal info into CRM forms"
          >
            <CheckBoxField name="browser_autocomplete" label="Enable browser autocomplete on forms" defaultChecked={s.browser_autocomplete} />
          </Row>
        </Section>
              </div>
            ) },
            { id: "notifications", label: "Notifications", content: (
              <div className="space-y-5">
        <Section title="Notifications On Main Nav Bar">
          <Row label="Alert Sound">
            <CheckBoxField name="notif_sound" label="Play Sound for new notifications" defaultChecked={s.notif_sound} />
          </Row>
          <Row label="Enable These Notifications">
            <CheckGroup name="notif_types" options={NOTIF_TYPES} selected={s.notif_types ?? []} />
          </Row>
          <Note>These light up the top bar as the timesheet / assignment / inbox systems come online.</Note>
        </Section>

        <Section title="Inbox Messages">
          <Row label="Top Navigation Bar Inbox Icon">
            <CheckBoxField name="inbox_show_counter" label="Show Message Counter" defaultChecked={s.inbox_show_counter} />
          </Row>
        </Section>
              </div>
            ) },
            { id: "defaults", label: "Defaults", content: (
              <div className="space-y-5">
        <Section title="Event Based Templates">
          <Row
            label="Default Preview Event"
            hint="Used when previewing email/document templates — blank uses the next upcoming booked event"
          >
            <select name="default_template_event_id" defaultValue={s.default_template_event_id ?? ""} className="input w-full max-w-md">
              <option value="">— Next upcoming booked event —</option>
              {(events ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || "(unnamed)"}{e.event_date ? ` — ${e.event_date}` : ""}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title="Master Administrator Landing Page">
          <Row label="Default Page" hint="Where XOS lands right after login">
            <select name="landing_page" defaultValue={s.landing_page ?? "/"} className="input w-full max-w-md">
              {LANDING_PAGES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Row>
        </Section>
              </div>
            ) },
          ]}
        />

        <div className="flex justify-end">
          <SaveButton>Save Settings</SaveButton>
        </div>
      </form>
    </div>
  );
}
