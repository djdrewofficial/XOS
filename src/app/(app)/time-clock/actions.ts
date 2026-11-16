"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMe, requireModule } from "@/lib/auth";
import { requireOffice } from "@/lib/fieldStaff";
import {
  canPunchWithoutLocation,
  distanceMeters,
  effectiveHourlyRate,
  hourlyAmount,
  nextPunchType,
  payableHoursFromPunches,
  type TimeClockSettingsLite,
} from "@/lib/timeClock";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

async function loadSettings(supabase: Awaited<ReturnType<typeof createClient>>): Promise<TimeClockSettingsLite | null> {
  const { data } = await supabase.from("time_clock_settings").select("*").eq("id", true).maybeSingle();
  return (data as TimeClockSettingsLite | null) ?? null;
}

async function employeeIdForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const me = await getMe(supabase);
  if (me?.employeeId) return me.employeeId;
  const { data } = await supabase.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
  return (data?.id as string | null) ?? null;
}

async function featCheckInEnabled(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data } = await supabase.from("staff_settings").select("feat_check_in_out").eq("id", true).maybeSingle();
  if (!data) return true;
  return data.feat_check_in_out !== false;
}

type Loc = {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  location_missing: boolean;
};

function locFromForm(formData: FormData): Loc {
  const lat = numOrNull(formData.get("lat"));
  const lng = numOrNull(formData.get("lng"));
  const accuracy_m = numOrNull(formData.get("accuracy_m"));
  const missing = formData.get("location_missing") === "1" || formData.get("location_missing") === "true";
  if (lat == null || lng == null) return { lat: null, lng: null, accuracy_m: null, location_missing: true };
  return { lat, lng, accuracy_m, location_missing: missing };
}

async function venueCoords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ lat: number | null; lng: number | null }> {
  const { data: ev } = await supabase.from("events").select("venue_id").eq("id", eventId).maybeSingle();
  if (!ev?.venue_id) return { lat: null, lng: null };
  const { data: v } = await supabase.from("venues").select("lat, lng").eq("id", ev.venue_id).maybeSingle();
  return { lat: v?.lat != null ? Number(v.lat) : null, lng: v?.lng != null ? Number(v.lng) : null };
}

function revalidateStaff(eventId: string) {
  revalidatePath("/");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/payroll");
}

/** Staff self-service punch (in or out). Captures GPS when provided. */
export async function selfPunch(eventStaffId: string, formData: FormData) {
  await requireModule("events", "view", { mode: "throw" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  if (!(await featCheckInEnabled(supabase))) throw new Error("Check in/out is turned off.");
  const settings = await loadSettings(supabase);
  if (settings && settings.enabled === false) throw new Error("Time clock is turned off.");

  const empId = await employeeIdForUser(supabase, user.id);
  const { data: row } = await supabase
    .from("event_staff")
    .select("id, employee_id, event_id, timesheet_status")
    .eq("id", eventStaffId)
    .maybeSingle();
  if (!empId || !row || row.employee_id !== empId) throw new Error("Not authorized.");
  if (row.timesheet_status === "approved" || row.timesheet_status === "locked" || row.timesheet_status === "paid") {
    throw new Error("This timesheet is locked. Ask an admin to unlock it.");
  }

  const loc = locFromForm(formData);
  if (loc.location_missing && !canPunchWithoutLocation(settings)) {
    throw new Error("Location is required to punch. Enable location and try again.");
  }

  const { data: existing } = await supabase
    .from("time_punches")
    .select("punch_type, punched_at, deleted_at")
    .eq("event_staff_id", eventStaffId)
    .is("deleted_at", null);
  const punchType = nextPunchType((existing ?? []) as { punch_type: string; punched_at: string; deleted_at: string | null }[]);

  const venue = await venueCoords(supabase, row.event_id as string);
  const capture = settings?.capture_distance !== false;
  const distance_m =
    capture && !loc.location_missing ? distanceMeters(loc.lat, loc.lng, venue.lat, venue.lng) : null;

  const punchedAt = clean(formData.get("punched_at")) ?? new Date().toISOString();
  const { error } = await supabase.from("time_punches").insert({
    event_staff_id: eventStaffId,
    employee_id: empId,
    event_id: row.event_id,
    punch_type: punchType,
    punched_at: punchedAt,
    lat: loc.lat,
    lng: loc.lng,
    accuracy_m: loc.accuracy_m,
    venue_lat: venue.lat,
    venue_lng: venue.lng,
    distance_m: distance_m != null ? Math.round(distance_m * 100) / 100 : null,
    location_missing: loc.location_missing,
    source: "self",
    created_by: empId,
  });
  if (error) throw new Error(error.message);
  revalidateStaff(row.event_id as string);
}

/** Admin insert/update/soft-delete a punch. Reason required. Audited. */
export async function adminUpsertPunch(formData: FormData) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  requireOffice(await getMe(supabase));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const editorId = await employeeIdForUser(supabase, user.id);
  if (!editorId) throw new Error("Your login is not linked to an employee profile.");

  const settings = await loadSettings(supabase);
  const reason = clean(formData.get("reason"));
  if ((settings?.admin_edit_requires_reason !== false) && !reason) {
    throw new Error("A reason is required for punch edits.");
  }

  const action = clean(formData.get("action")) ?? "insert";
  const punchId = clean(formData.get("punch_id"));
  const eventStaffId = clean(formData.get("event_staff_id"));

  if (action === "delete") {
    if (!punchId) throw new Error("Missing punch.");
    const { data: before } = await supabase.from("time_punches").select("*").eq("id", punchId).maybeSingle();
    if (!before) throw new Error("Punch not found.");
    if (before.deleted_at) throw new Error("Punch already deleted.");
    // RPC sets edit reason and soft-deletes in one tx; audit trigger writes time_punch_edits.
    const { error } = await supabase.rpc("xos_time_punch_admin_soft_delete", {
      p_id: punchId,
      p_reason: reason ?? "deleted",
    });
    if (error) throw new Error(error.message);
    // unlock timesheet if it was approved on punch change
    await supabase
      .from("event_staff")
      .update({
        timesheet_status: "open",
        timesheet_approved_at: null,
        timesheet_approved_by: null,
        timesheet_locked_at: null,
        timesheet_amount: null,
        timesheet_hours: null,
        timesheet_rate: null,
      })
      .eq("id", before.event_staff_id)
      .in("timesheet_status", ["approved", "locked"]);
    revalidateStaff(before.event_id as string);
    return;
  }

  if (action === "update") {
    if (!punchId) throw new Error("Missing punch.");
    const { data: before } = await supabase.from("time_punches").select("*").eq("id", punchId).maybeSingle();
    if (!before || before.deleted_at) throw new Error("Punch not found.");
    const loc = locFromForm(formData);
    const punched_at = clean(formData.get("punched_at")) ?? before.punched_at;
    const punch_type = clean(formData.get("punch_type")) ?? before.punch_type;
    const venue = await venueCoords(supabase, before.event_id as string);
    const distance_m =
      !loc.location_missing ? distanceMeters(loc.lat, loc.lng, venue.lat ?? before.venue_lat, venue.lng ?? before.venue_lng) : null;
    const patch = {
      punch_type,
      punched_at,
      lat: loc.location_missing ? null : loc.lat,
      lng: loc.location_missing ? null : loc.lng,
      accuracy_m: loc.accuracy_m,
      venue_lat: venue.lat ?? before.venue_lat,
      venue_lng: venue.lng ?? before.venue_lng,
      distance_m: distance_m != null ? Math.round(distance_m * 100) / 100 : null,
      location_missing: loc.location_missing,
      note: clean(formData.get("note")),
      source: "admin",
    };
    // RPC sets edit reason and updates in one tx; audit trigger writes time_punch_edits.
    const { error } = await supabase.rpc("xos_time_punch_admin_update", {
      p_id: punchId,
      p_patch: patch,
      p_reason: reason ?? "updated",
    });
    if (error) throw new Error(error.message);
    await supabase
      .from("event_staff")
      .update({
        timesheet_status: "open",
        timesheet_approved_at: null,
        timesheet_approved_by: null,
        timesheet_locked_at: null,
        timesheet_amount: null,
        timesheet_hours: null,
        timesheet_rate: null,
      })
      .eq("id", before.event_staff_id)
      .in("timesheet_status", ["approved", "locked"]);
    revalidateStaff(before.event_id as string);
    return;
  }

  // insert
  if (!eventStaffId) throw new Error("Missing assignment.");
  const { data: row } = await supabase
    .from("event_staff")
    .select("id, employee_id, event_id")
    .eq("id", eventStaffId)
    .maybeSingle();
  if (!row) throw new Error("Assignment not found.");
  const loc = locFromForm(formData);
  const punch_type = clean(formData.get("punch_type")) ?? "in";
  const punched_at = clean(formData.get("punched_at")) ?? new Date().toISOString();
  const venue = await venueCoords(supabase, row.event_id as string);
  const distance_m =
    !loc.location_missing ? distanceMeters(loc.lat, loc.lng, venue.lat, venue.lng) : null;
  const { data: after, error } = await supabase
    .from("time_punches")
    .insert({
      event_staff_id: eventStaffId,
      employee_id: row.employee_id,
      event_id: row.event_id,
      punch_type,
      punched_at,
      lat: loc.lat,
      lng: loc.lng,
      accuracy_m: loc.accuracy_m,
      venue_lat: venue.lat,
      venue_lng: venue.lng,
      distance_m: distance_m != null ? Math.round(distance_m * 100) / 100 : null,
      location_missing: loc.location_missing,
      source: "admin",
      note: clean(formData.get("note")),
      created_by: editorId,
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  await supabase.from("time_punch_edits").insert({
    punch_id: after?.id ?? null,
    event_staff_id: eventStaffId,
    action: "insert",
    before_row: null,
    after_row: after,
    reason: reason ?? "added",
    edited_by: editorId,
  });
  await supabase
    .from("event_staff")
    .update({
      timesheet_status: "open",
      timesheet_approved_at: null,
      timesheet_approved_by: null,
      timesheet_locked_at: null,
      timesheet_amount: null,
      timesheet_hours: null,
      timesheet_rate: null,
    })
    .eq("id", eventStaffId)
    .in("timesheet_status", ["approved", "locked"]);
  revalidateStaff(row.event_id as string);
}

/** Approve + lock an hourly timesheet (required before payroll generate). */
export async function approveTimesheet(eventStaffId: string) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  requireOffice(await getMe(supabase));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const editorId = await employeeIdForUser(supabase, user.id);

  const { data: row } = await supabase
    .from("event_staff")
    .select("id, event_id, pay_type, flat_wage, hourly_rate_override, timesheet_status, employee:employees(hourly_rate)")
    .eq("id", eventStaffId)
    .maybeSingle();
  if (!row) throw new Error("Assignment not found.");
  if ((row.pay_type ?? "flat") !== "hourly") throw new Error("Only hourly assignments need timesheet approval.");

  const { data: punches } = await supabase
    .from("time_punches")
    .select("punch_type, punched_at, deleted_at")
    .eq("event_staff_id", eventStaffId)
    .is("deleted_at", null);
  const settings = await loadSettings(supabase);
  const hours = payableHoursFromPunches((punches ?? []) as { punch_type: string; punched_at: string; deleted_at: string | null }[], settings, 0);
  const emp = row.employee as { hourly_rate?: number | null } | null;
  const rate = effectiveHourlyRate(row, emp);
  const amount = hourlyAmount(hours, rate);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("event_staff")
    .update({
      timesheet_status: "locked",
      timesheet_hours: hours,
      timesheet_rate: rate,
      timesheet_amount: amount,
      timesheet_approved_by: editorId,
      timesheet_approved_at: now,
      timesheet_locked_at: now,
    })
    .eq("id", eventStaffId);
  if (error) throw new Error(error.message);
  revalidateStaff(row.event_id as string);
}

export async function unlockTimesheet(eventStaffId: string, formData?: FormData) {
  await requireModule("payroll", "edit", { mode: "throw" });
  const supabase = await createClient();
  requireOffice(await getMe(supabase));
  const reason = clean(formData?.get("reason") ?? null);
  if (!reason) throw new Error("A reason is required to unlock.");

  const { data: row } = await supabase
    .from("event_staff")
    .select("id, event_id, timesheet_status")
    .eq("id", eventStaffId)
    .maybeSingle();
  if (!row) throw new Error("Assignment not found.");
  if (row.timesheet_status === "paid") throw new Error("This timesheet was already paid.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const editorId = user ? await employeeIdForUser(supabase, user.id) : null;

  const { error } = await supabase
    .from("event_staff")
    .update({
      timesheet_status: "open",
      timesheet_approved_at: null,
      timesheet_approved_by: null,
      timesheet_locked_at: null,
      // keep hours/amount as last snapshot until re-approved; clear payable link
      timesheet_payable_id: null,
    })
    .eq("id", eventStaffId);
  if (error) throw new Error(error.message);

  if (editorId) {
    await supabase.from("time_punch_edits").insert({
      punch_id: null,
      event_staff_id: eventStaffId,
      action: "update",
      before_row: { timesheet_status: row.timesheet_status },
      after_row: { timesheet_status: "open", unlock_reason: reason },
      reason,
      edited_by: editorId,
    });
  }
  revalidateStaff(row.event_id as string);
}
