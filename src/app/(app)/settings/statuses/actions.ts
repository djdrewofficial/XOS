"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function statusPayload(formData: FormData) {
  return {
    name: clean(formData.get("name")) ?? "Untitled",
    color: clean(formData.get("color")) ?? "#F0F0F0",
    text_color: clean(formData.get("text_color")) ?? "#000000",
    sort_order: parseInt(clean(formData.get("sort_order")) ?? "0") || 0,
    is_active: formData.get("is_active") === "on",
    is_booked_group: formData.get("is_booked_group") === "on",
    is_pending_group: formData.get("is_pending_group") === "on",
    is_lost_sale_group: formData.get("is_lost_sale_group") === "on",
    is_leads_group: formData.get("is_leads_group") === "on",
    counts_financial: formData.get("counts_financial") === "on",
    counts_availability: formData.get("counts_availability") === "on",
    counts_payroll: formData.get("counts_payroll") === "on",
  };
}

export async function createStatus(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("event_statuses").insert(statusPayload(formData));
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
}

export async function updateStatus(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("event_statuses").update(statusPayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
  revalidatePath("/events");
}

export async function deleteStatus(id: string) {
  const supabase = await createClient();
  // refuse if any event or daily action references it
  const [{ count: evCount }, { count: daFrom }, { count: daTo }] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status_id", id),
    supabase.from("daily_status_actions").select("id", { count: "exact", head: true }).eq("from_status_id", id),
    supabase.from("daily_status_actions").select("id", { count: "exact", head: true }).eq("to_status_id", id),
  ]);
  if ((evCount ?? 0) > 0 || (daFrom ?? 0) > 0 || (daTo ?? 0) > 0) {
    throw new Error("Status is in use by events or scheduled actions — deactivate it instead.");
  }
  const { error } = await supabase.from("event_statuses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
}

export async function createDailyAction(formData: FormData) {
  const supabase = await createClient();
  const from = clean(formData.get("from_status_id"));
  const to = clean(formData.get("to_status_id"));
  if (!from || !to) return;
  const { error } = await supabase.from("daily_status_actions").insert({
    trigger_type: clean(formData.get("trigger_type")) ?? "event_date_passed",
    from_status_id: from,
    to_status_id: to,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
}

export async function toggleDailyAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("daily_status_actions")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
}

export async function deleteDailyAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("daily_status_actions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
}

export async function runDailyActionsNow() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_daily_status_actions");
  if (error) throw new Error(error.message);
  revalidatePath("/settings/statuses");
  revalidatePath("/events");
  revalidatePath("/");
}
