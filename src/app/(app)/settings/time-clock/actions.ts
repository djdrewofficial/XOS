"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null, fallback = 0): number {
  const n = parseFloat((v ?? "").toString());
  return Number.isFinite(n) ? n : fallback;
}
function on(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export async function saveTimeClockSettings(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();

  const geofence_mode = clean(formData.get("geofence_mode")) ?? "off";
  const patch = {
    enabled: on(formData, "enabled"),
    allow_punch_without_location: on(formData, "allow_punch_without_location"),
    capture_distance: on(formData, "capture_distance"),
    geofence_enabled: on(formData, "geofence_enabled"),
    geofence_radius_m: Math.max(1, Math.round(num(formData.get("geofence_radius_m"), 500))),
    geofence_mode: ["off", "warn", "block"].includes(geofence_mode) ? geofence_mode : "off",
    include_travel_for_hourly_punches: on(formData, "include_travel_for_hourly_punches"),
    apply_rounding: on(formData, "apply_rounding"),
    rounding_minutes: Math.round(num(formData.get("rounding_minutes"), 15)),
    apply_overtime: on(formData, "apply_overtime"),
    overtime_weekly_hours: num(formData.get("overtime_weekly_hours"), 40),
    overtime_multiplier: num(formData.get("overtime_multiplier"), 1.5),
    apply_min_hours: on(formData, "apply_min_hours"),
    min_hours: num(formData.get("min_hours"), 0),
    enable_breaks: on(formData, "enable_breaks"),
    require_approval_before_payroll: on(formData, "require_approval_before_payroll"),
    admin_edit_requires_reason: on(formData, "admin_edit_requires_reason"),
    missed_punch_grace_minutes: Math.max(0, Math.round(num(formData.get("missed_punch_grace_minutes"), 30))),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("time_clock_settings").upsert({ id: true, ...patch });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/time-clock");
  revalidatePath("/payroll");
  revalidatePath("/");
}
