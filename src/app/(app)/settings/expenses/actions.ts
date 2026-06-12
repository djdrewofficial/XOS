"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function lines(v: FormDataEntryValue | null): string[] {
  return (v ?? "")
    .toString()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Payees list (expense_settings) + expense payment methods (lives in payment_settings too). */
export async function saveExpenseLists(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_settings")
    .update({ payees: lines(formData.get("payees")), updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);

  const { error: pmError } = await supabase
    .from("payment_settings")
    .update({ expense_payment_methods: lines(formData.get("expense_payment_methods")) })
    .eq("id", true);
  if (pmError) throw new Error(pmError.message);

  revalidatePath("/settings/expenses");
  revalidatePath("/settings/payment-settings");
}

export async function addExpenseCategory(formData: FormData) {
  const name = clean(formData.get("name"));
  if (!name) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_categories")
    .upsert({ name, is_active: true }, { onConflict: "name" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/expenses");
}

export async function toggleExpenseCategory(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/expenses");
}

export async function saveAutoMileage(formData: FormData) {
  const supabase = await createClient();
  const rate = parseFloat(clean(formData.get("mileage_rate")) ?? "0.70");
  const { error } = await supabase
    .from("expense_settings")
    .update({
      auto_mileage_enabled: formData.get("auto_mileage_enabled") === "on",
      mileage_rate: Number.isFinite(rate) ? rate : 0.7,
      mileage_round_trip: formData.get("mileage_round_trip") === "on",
      mileage_category_id: clean(formData.get("mileage_category_id")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/expenses");
}

/** Per-venue mileage toggle + one-way distance — also editable on the venue page. */
export async function saveVenueMileage(venueId: string, formData: FormData) {
  const supabase = await createClient();
  const dist = clean(formData.get("distance_miles"));
  const { error } = await supabase
    .from("venues")
    .update({
      auto_mileage: formData.get("auto_mileage") === "on",
      distance_miles: dist === null ? null : parseFloat(dist),
    })
    .eq("id", venueId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/expenses");
  revalidatePath(`/venues/${venueId}`);
}

export async function runAutoMileageNow() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_auto_mileage");
  if (error) throw new Error(error.message);
  revalidatePath("/settings/expenses");
  revalidatePath("/events");
}
