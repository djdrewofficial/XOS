import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note, CheckBoxField } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import { saveTimeClockSettings } from "./actions";
import { DEFAULT_TIME_CLOCK_SETTINGS } from "@/lib/timeClock";

export const dynamic = "force-dynamic";

export default async function TimeClockSettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("time_clock_settings").select("*").eq("id", true).maybeSingle();

  if (!settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Time Clock</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00230_time_clock.sql</code>{" "}
            in the Supabase SQL editor (or apply_migration), then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = { ...DEFAULT_TIME_CLOCK_SETTINGS, ...settings };

  return (
    <div className="max-w-[1100px]">
      <h1 className="page-title mb-2">Time Clock</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Rules for staff clock in/out, GPS capture, and hourly timesheet approval before payroll.
        Staff Settings still has the master &quot;Check In/Out System&quot; feature flag.
      </p>

      <form action={saveTimeClockSettings} className="space-y-5">
        <Section title="Master">
          <CheckBoxField name="enabled" label="Time clock enabled" defaultChecked={!!s.enabled} />
          <Note>When off, staff cannot punch (even if Check In/Out is on in Staff Settings).</Note>
        </Section>

        <Section title="Location">
          <CheckBoxField
            name="allow_punch_without_location"
            label="Allow punch when location permission is denied"
            defaultChecked={!!s.allow_punch_without_location}
          />
          <Note>Default on: punch is saved and flagged &quot;no location&quot;. Turn off to require GPS.</Note>
          <CheckBoxField
            name="capture_distance"
            label="Store distance from venue on each punch"
            defaultChecked={!!s.capture_distance}
          />
          <CheckBoxField name="geofence_enabled" label="Enable geofence (optional)" defaultChecked={!!s.geofence_enabled} />
          <Row label="Geofence radius (meters)">
            <input type="number" name="geofence_radius_m" min={1} defaultValue={s.geofence_radius_m} className="input w-40" />
          </Row>
          <Row label="Geofence mode">
            <select name="geofence_mode" defaultValue={s.geofence_mode ?? "off"} className="input w-48">
              <option value="off">Off (capture only)</option>
              <option value="warn">Warn (still allow)</option>
              <option value="block">Block outside radius</option>
            </select>
          </Row>
          <Note>Current company policy captures GPS for reference only with mode Off.</Note>
        </Section>

        <Section title="Pay calculation">
          <CheckBoxField
            name="include_travel_for_hourly_punches"
            label="Add venue travel time on top of clocked hours"
            defaultChecked={!!s.include_travel_for_hourly_punches}
          />
          <Note>Default off: hourly staff are paid for clocked time only (they clock in before travel).</Note>
          <CheckBoxField name="apply_rounding" label="Round punch hours" defaultChecked={!!s.apply_rounding} />
          <Row label="Rounding increment (minutes)">
            <select name="rounding_minutes" defaultValue={String(s.rounding_minutes)} className="input w-40">
              {[1, 5, 6, 10, 15, 30].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Row>
          <CheckBoxField name="apply_overtime" label="Apply weekly overtime multiplier" defaultChecked={!!s.apply_overtime} />
          <Row label="OT weekly threshold (hours)">
            <input type="number" step="0.1" name="overtime_weekly_hours" defaultValue={s.overtime_weekly_hours} className="input w-40" />
          </Row>
          <Row label="OT multiplier">
            <input type="number" step="0.1" name="overtime_multiplier" defaultValue={s.overtime_multiplier} className="input w-40" />
          </Row>
          <CheckBoxField name="apply_min_hours" label="Enforce minimum hours per assignment" defaultChecked={!!s.apply_min_hours} />
          <Row label="Minimum hours">
            <input type="number" step="0.25" name="min_hours" defaultValue={s.min_hours} className="input w-40" />
          </Row>
          <CheckBoxField name="enable_breaks" label="Enable break punches (future)" defaultChecked={!!s.enable_breaks} />
          <Note>Break punches are not used yet; only in/out pairs. The toggle is here so the rule is editable when you turn it on later.</Note>
        </Section>

        <Section title="Approval & missed punches">
          <CheckBoxField
            name="require_approval_before_payroll"
            label="Require approved/locked timesheet before payroll generate (hourly)"
            defaultChecked={!!s.require_approval_before_payroll}
          />
          <CheckBoxField
            name="admin_edit_requires_reason"
            label="Require a reason for every admin punch edit"
            defaultChecked={!!s.admin_edit_requires_reason}
          />
          <Row label="Missed-punch grace (minutes after scheduled start)">
            <input
              type="number"
              min={0}
              name="missed_punch_grace_minutes"
              defaultValue={s.missed_punch_grace_minutes}
              className="input w-40"
            />
          </Row>
        </Section>

        <div className="flex justify-end">
          <SaveButton>Save Time Clock Settings</SaveButton>
        </div>
      </form>
    </div>
  );
}
