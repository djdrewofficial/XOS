"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
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
  await requireModule("settings", "edit", { mode: "throw" });
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
      online_pay_enabled: formData.get("online_pay_enabled") === "on",
      paypal_pay_enabled: formData.get("paypal_pay_enabled") === "on",
      paypal_fee_pct: parseFloat(clean(formData.get("paypal_fee_pct")) ?? "4") || 0,
      zelle_pay_enabled: formData.get("zelle_pay_enabled") === "on",
      zelle_display_name: clean(formData.get("zelle_display_name")) ?? "Xpress Entertainment",
      zelle_handle: clean(formData.get("zelle_handle")),
      zelle_memo: clean(formData.get("zelle_memo")) ?? "Include your event date in the memo",
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/payment-settings");
  revalidatePath("/events");
}
