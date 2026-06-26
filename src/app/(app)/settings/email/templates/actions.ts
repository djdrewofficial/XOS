"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function ids(formData: FormData, name: string): string[] {
  return formData.getAll(name).map(String).filter(Boolean);
}
function intOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseInt((v ?? "").toString(), 10);
  return Number.isFinite(n) ? n : null;
}

function buildPayload(formData: FormData) {
  const packageIds = ids(formData, "sched_package_ids");
  const salespersonIds = ids(formData, "sched_salesperson_ids");
  const employeeIds = ids(formData, "sched_employee_ids");
  const visPackageIds = ids(formData, "vis_package_ids");

  return {
    // Content
    name: clean(formData.get("display_name")) ?? "Untitled Template",
    display_name: clean(formData.get("display_name")),
    group_name: clean(formData.get("group_name")) ?? "GENERAL",
    subject: clean(formData.get("subject")) ?? "",
    body_html: clean(formData.get("body_html")) ?? "",
    is_active: formData.get("is_active") === "on",

    // Settings — autofill (manual sends)
    autofill_send_to: ids(formData, "autofill_send_to"),
    autofill_specific_email: clean(formData.get("autofill_specific_email")),
    include_signature: formData.get("include_signature") === "on",
    after_set_status_id: clean(formData.get("after_set_status_id")),
    after_run_helper_id: clean(formData.get("after_run_helper_id")),

    // Scheduling
    schedule_enabled: formData.get("schedule_enabled") === "on",
    schedule_days: intOrNull(formData.get("schedule_days")),
    schedule_direction: clean(formData.get("schedule_direction")) ?? "before",
    schedule_anchor: clean(formData.get("schedule_anchor")) ?? "event_date",
    schedule_send_time: clean(formData.get("schedule_send_time")) ?? "09:00",
    sched_status_ids: ids(formData, "sched_status_ids"),
    sched_event_type_ids: ids(formData, "sched_event_type_ids"),
    sched_packages_mode: packageIds.length > 0 ? "selected" : "all",
    sched_package_ids: packageIds,
    sched_addons_mode: clean(formData.get("sched_addons_mode")) ?? "all",
    sched_addon_ids: ids(formData, "sched_addon_ids"),
    sched_payments: clean(formData.get("sched_payments")) ?? "any",
    sched_salesperson_mode: salespersonIds.length > 0 ? "selected" : "any",
    sched_salesperson_ids: salespersonIds,
    sched_employee_mode: employeeIds.length > 0 ? "selected" : "any",
    sched_employee_ids: employeeIds,
    schedule_from: clean(formData.get("schedule_from")) ?? "company",
    sched_send_to: ids(formData, "sched_send_to"),
    sched_vendor_category_ids: ids(formData, "sched_vendor_category_ids"),
    sched_exclude_declined: formData.get("sched_exclude_declined") === "on",
    sched_also_send_to: clean(formData.get("sched_also_send_to")),
    sched_set_status_id: clean(formData.get("sched_set_status_id")),
    sched_run_helper_id: clean(formData.get("sched_run_helper_id")),

    // Visibility
    vis_status_ids: ids(formData, "vis_status_ids"),
    vis_event_type_ids: ids(formData, "vis_event_type_ids"),
    vis_packages_mode: visPackageIds.length > 0 ? "selected" : "all",
    vis_package_ids: visPackageIds,
    vis_addons_mode: clean(formData.get("vis_addons_mode")) ?? "all",
    vis_addon_ids: ids(formData, "vis_addon_ids"),
    employee_visibility: clean(formData.get("employee_visibility")) ?? "admins_salespeople",
    is_inbox_reply: formData.get("is_inbox_reply") === "on",
    is_vendor_template: formData.get("is_vendor_template") === "on",
    is_venue_template: formData.get("is_venue_template") === "on",

    // Attached document (e-sign link or PDF generated at send time)
    attach_template_id: clean(formData.get("attach_template_id")),
    attach_mode: clean(formData.get("attach_mode")) ?? "esign_link",
    // OFF = plain email for deliverability (follow-ups)
    branded_shell: formData.get("branded_shell") === "on",
  };
}

export async function createBlankTemplate() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_templates")
    .insert({ name: "New Email Template", display_name: "New Email Template", group_name: "GENERAL", subject: "", body_html: "", is_active: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
  redirect(`/settings/email/templates/${data.id}`);
}

export async function updateTemplate(id: string, formData: FormData) {
  const supabase = await createClient();
  // Saving acknowledges any import-time review flags (unmapped anchor/status).
  // The blank-subject flag is derived live, so it persists until a subject is set.
  const { error } = await supabase
    .from("email_templates")
    .update({ ...buildPayload(formData), review_reasons: [] })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
  revalidatePath(`/settings/email/templates/${id}`);
  redirect("/settings/email");
}

export async function deleteTemplate(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("email_templates").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}

export async function duplicateTemplate(id: string) {
  const supabase = await createClient();
  const { data: src } = await supabase.from("email_templates").select("*").eq("id", id).single();
  if (!src) return;
  const { id: _omit, created_at: _omit2, ...rest } = src;
  void _omit;
  void _omit2;
  const { error } = await supabase.from("email_templates").insert({
    ...rest,
    name: `${src.name} (Copy)`,
    display_name: `${src.display_name ?? src.name} (Copy)`,
    is_active: false,
    schedule_enabled: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/email");
}
