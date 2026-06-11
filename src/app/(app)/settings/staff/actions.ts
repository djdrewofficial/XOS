"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  PERM_SECTIONS,
  PERM_VIEW_ALL,
  PERM_NOTES,
  PORTAL_FIELDS,
} from "./constants";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = clean(v);
  if (s === null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

async function save(patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/staff");
}

export async function saveFeatures(formData: FormData) {
  await save({
    feat_time_off: formData.get("feat_time_off") === "on",
    feat_confirm_events: formData.get("feat_confirm_events") === "on",
    feat_decline_events: formData.get("feat_decline_events") === "on",
    feat_check_in_out: formData.get("feat_check_in_out") === "on",
    feat_timesheets: formData.get("feat_timesheets") === "on",
    feat_wage_report: formData.get("feat_wage_report") === "on",
    feat_available_events: formData.get("feat_available_events") === "on",
    feat_event_count: formData.get("feat_event_count") === "on",
    time_off_mode: clean(formData.get("time_off_mode")) ?? "any",
    time_off_advance_days: intOrNull(formData.get("time_off_advance_days")),
    time_off_allow_delete: formData.get("time_off_allow_delete") === "on",
    time_off_auto_approve: formData.get("time_off_auto_approve") === "on",
    time_off_terminology: clean(formData.get("time_off_terminology")) ?? "Approved",
    decline_requires_reason: formData.get("decline_requires_reason") === "on",
    show_past_event_count: formData.get("show_past_event_count") === "on",
    show_upcoming_event_count: formData.get("show_upcoming_event_count") === "on",
  });
}

export async function saveAccess(formData: FormData) {
  const ids = formData.getAll("access_status_ids").map(String).filter(Boolean);
  await save({
    access_status_ids: ids.length > 0 ? ids : null,
    access_days_before: intOrNull(formData.get("access_days_before")),
    access_days_after: intOrNull(formData.get("access_days_after")),
  });
}

export async function savePermissions(formData: FormData) {
  const sections: Record<string, boolean> = {};
  for (const [key] of PERM_SECTIONS) sections[key] = formData.get(`sec_${key}`) === "on";

  const view: Record<string, boolean> = {};
  for (const [key] of PERM_VIEW_ALL) view[key] = formData.get(`view_${key}`) === "on";

  const notes: Record<string, boolean> = {};
  for (const [key] of PERM_NOTES) notes[key] = formData.get(`note_${key}`) === "on";

  const portal: Record<string, { view: boolean; edit: boolean }> = {};
  for (const [key] of PORTAL_FIELDS) {
    portal[key] = {
      view: formData.get(`portal_view_${key}`) === "on",
      edit: formData.get(`portal_edit_${key}`) === "on",
    };
  }

  await save({
    perm_sections: sections,
    perm_view: view,
    perm_notes: notes,
    portal_fields: portal,
  });
}

export async function saveNotifications(formData: FormData) {
  const excludeEmployees = formData.getAll("notif_exclude_employee_ids").map(String).filter(Boolean);
  const excludeStatuses = formData.getAll("notif_exclude_status_ids").map(String).filter(Boolean);
  await save({
    notify_request_event: clean(formData.get("notify_request_event")),
    notify_check_in: clean(formData.get("notify_check_in")),
    notify_check_out: clean(formData.get("notify_check_out")),
    notify_timesheet: clean(formData.get("notify_timesheet")),
    notify_time_off: clean(formData.get("notify_time_off")),
    notify_confirm_decline: clean(formData.get("notify_confirm_decline")),
    notify_confirm_also_salesperson: formData.get("notify_confirm_also_salesperson") === "on",
    assign_employee_template_id: clean(formData.get("assign_employee_template_id")),
    assign_salesperson_template_id: clean(formData.get("assign_salesperson_template_id")),
    assign_mark_notified: formData.get("assign_mark_notified") === "on",
    notif_exclude_employee_ids: excludeEmployees.length > 0 ? excludeEmployees : null,
    notif_exclude_status_ids: excludeStatuses.length > 0 ? excludeStatuses : null,
  });
}

export async function savePayroll(formData: FormData) {
  const fields = formData.getAll("payroll_export_fields").map(String).filter(Boolean);
  await save({
    payroll_sort_day: clean(formData.get("payroll_sort_day")) ?? "event_type",
    payroll_sort_event: clean(formData.get("payroll_sort_event")) ?? "first_last",
    payroll_name_format: clean(formData.get("payroll_name_format")) ?? "first_last",
    payroll_start_offset_days: intOrNull(formData.get("payroll_start_offset_days")) ?? 7,
    payroll_end_offset_days: intOrNull(formData.get("payroll_end_offset_days")) ?? 0,
    payroll_export_fields: fields,
  });
}

export async function saveAvailabilitySort(formData: FormData) {
  await save({
    availability_sort: clean(formData.get("availability_sort")) ?? "display_order",
  });
}

/** Per-employee settings that also live on the employee profile page. */
export async function saveEmployeeRow(id: string, formData: FormData) {
  const supabase = await createClient();
  const rate = clean(formData.get("hourly_rate"));
  const { error } = await supabase
    .from("employees")
    .update({
      permission_tier: clean(formData.get("permission_tier")) ?? "employee",
      hourly_rate: rate === null ? null : parseFloat(rate),
      display_order: intOrNull(formData.get("display_order")) ?? 0,
      check_in_required: formData.get("check_in_required") === "on",
      can_send_as_self: formData.get("can_send_as_self") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/staff");
  revalidatePath(`/employees/${id}`);
}
