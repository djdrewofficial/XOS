"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function lines(v: FormDataEntryValue | null): string[] {
  return (v ?? "")
    .toString()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function savePaymentSettings(formData: FormData) {
  const supabase = await createClient();
  const prefill = [
    clean(formData.get("prefill_0")) ?? "",
    clean(formData.get("prefill_1")) ?? "",
    clean(formData.get("prefill_2")) ?? "",
  ];
  const { error } = await supabase
    .from("payment_settings")
    .update({
      payment_methods: lines(formData.get("payment_methods")),
      expense_payment_methods: lines(formData.get("expense_payment_methods")),
      payment_reasons: lines(formData.get("payment_reasons")),
      prefill_reasons: prefill,
      autofill_no_payments: clean(formData.get("autofill_no_payments")) ?? "disabled",
      autofill_after_payments: clean(formData.get("autofill_after_payments")) ?? "disabled",
      past_due_adjust_days: parseInt(clean(formData.get("past_due_adjust_days")) ?? "0", 10) || 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-settings");
  revalidatePath("/events");
}
