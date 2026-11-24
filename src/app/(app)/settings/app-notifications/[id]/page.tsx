import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { Section, Row, CheckBoxField, Note } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import { ANCHOR_LABELS } from "@/lib/scheduledComms";
import { APP_NOTIF_TABS } from "@/lib/appNotificationsLogic";
import { deleteTemplate, updateTemplate } from "../actions";
import AppNotifPreview from "@/components/AppNotifPreview";

export const dynamic = "force-dynamic";

export default async function AppNotificationTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("settings", "view", { mode: "redirect" });
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: tpl }, { data: screens }, { data: statuses }, { data: sampleEvents }] = await Promise.all([
    supabase.from("app_notification_templates").select("*").eq("id", id).maybeSingle(),
    supabase.from("app_notification_screens").select("id, name").eq("is_active", true).order("name"),
    supabase.from("event_statuses").select("id, name, color").eq("is_active", true).order("sort_order"),
    supabase
      .from("events")
      .select("id, name, event_date")
      .is("archived_at", null)
      .order("event_date", { ascending: false })
      .limit(40),
  ]);
  if (!tpl) notFound();

  const statusIds = new Set((tpl.status_ids ?? []) as string[]);
  const schedStatusIds = new Set((tpl.sched_status_ids ?? []) as string[]);

  return (
    <div className="max-w-3xl">
      <form action={updateTemplate.bind(null, id)}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/settings/app-notifications" className="text-xs font-semibold text-zinc-500 hover:underline">
              ← App Notifications
            </Link>
            <h1 className="page-title mt-1">Edit notification</h1>
            <p className="text-sm text-zinc-500">{tpl.name}</p>
          </div>
          <SaveButton className="btn-primary px-8">Save</SaveButton>
        </div>

        <div className="space-y-5">
          <Section title="Content">
            <Row label="Internal name">
              <input name="name" defaultValue={tpl.name} required className="input w-full" />
            </Row>
            <Row label="Push / popup title" hint="Merge tags supported.">
              <input name="title" defaultValue={tpl.title ?? ""} className="input w-full" />
            </Row>
            <Row label="Body" hint="Plain text for the push banner. Merge tags: <event_name>, <dj_name>, <dj_booking_url>, …">
              <textarea name="body" defaultValue={tpl.body ?? ""} rows={4} className="input w-full" />
            </Row>
            <Row label="Active">
              <CheckBoxField name="is_active" label="Enabled" defaultChecked={Boolean(tpl.is_active)} />
            </Row>
            <Row label="Audience">
              <select name="audience" defaultValue={tpl.audience ?? "hosts"} className="input w-full">
                <option value="hosts">Hosts only</option>
                <option value="hosts_and_guests">Hosts and guests</option>
                <option value="guests">Guests only</option>
              </select>
            </Row>
            <Row label="Delivery">
              <div className="flex flex-col gap-2">
                <CheckBoxField name="send_push" label="Send Expo push" defaultChecked={tpl.send_push !== false} />
                <CheckBoxField
                  name="show_as_popup"
                  label="Show as in-app popup when the app opens"
                  defaultChecked={tpl.show_as_popup !== false}
                />
                <CheckBoxField
                  name="allow_demo_mode"
                  label="Allow on demo-mode events"
                  defaultChecked={Boolean(tpl.allow_demo_mode)}
                />
              </div>
            </Row>
          </Section>

          <Section title="Trigger">
            <Row label="When">
              <select name="trigger_type" defaultValue={tpl.trigger_type ?? "schedule"} className="input w-full">
                <option value="schedule">N days before / after a date</option>
                <option value="status_change">On status change</option>
                <option value="helper">Helper action only</option>
              </select>
            </Row>
            <Row label="Days / direction" hint="Used when trigger is schedule.">
              <div className="flex flex-wrap gap-2">
                <input
                  name="schedule_days"
                  type="number"
                  min={0}
                  defaultValue={tpl.schedule_days ?? 7}
                  className="input w-24"
                />
                <select name="schedule_direction" defaultValue={tpl.schedule_direction ?? "before"} className="input">
                  <option value="before">before</option>
                  <option value="after">after</option>
                </select>
                <select name="schedule_anchor" defaultValue={tpl.schedule_anchor ?? "event_date"} className="input">
                  {Object.entries(ANCHOR_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
            <Row label="Send time" hint="Company timezone.">
              <input
                name="schedule_send_time"
                type="time"
                defaultValue={(tpl.schedule_send_time ?? "09:00").toString().slice(0, 5)}
                className="input w-36"
              />
            </Row>
            <Row label="Status filter (schedule)" hint="Empty = any status. Cancelled / archived / demo are still skipped unless demo is allowed.">
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-white/10">
                {(statuses ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="sched_status_ids" value={s.id} defaultChecked={schedStatusIds.has(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </Row>
            <Row label="Fire on statuses" hint="Used when trigger is status change.">
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-white/10">
                {(statuses ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="status_ids" value={s.id} defaultChecked={statusIds.has(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </Row>
            <Note>
              Helper-only templates are available as a &quot;Couple App Notification&quot; step on booking helpers.
            </Note>
          </Section>

          <Section title="Tap action">
            <Row label="On tap">
              <select name="tap_action" defaultValue={tpl.tap_action ?? "none"} className="input w-full">
                <option value="none">Open message only</option>
                <option value="tab">Open an app tab</option>
                <option value="screen">Open a custom screen</option>
              </select>
            </Row>
            <Row label="App tab">
              <select name="tap_tab" defaultValue={tpl.tap_tab ?? "home"} className="input w-full">
                {APP_NOTIF_TABS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Custom screen">
              <select name="tap_screen_id" defaultValue={tpl.tap_screen_id ?? ""} className="input w-full">
                <option value="">(none)</option>
                {(screens ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Row>
          </Section>
        </div>
      </form>

      <div className="mt-8 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Preview</h2>
        <AppNotifPreview templateId={id} events={(sampleEvents ?? []) as { id: string; name: string; event_date: string | null }[]} />
      </div>

      <form action={deleteTemplate.bind(null, id)} className="mt-8">
        <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">
          Delete template
        </button>
      </form>
    </div>
  );
}
