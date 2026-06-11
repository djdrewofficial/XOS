"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updatePackageFinancials(packageId: string, formData: FormData) {
  const supabase = await createClient();
  const splits = formData
    .getAll("allowed_splits")
    .map((v) => parseInt(v.toString()))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  const terms = formData.get("payment_terms")?.toString() ?? "days_before";
  const days = parseInt(formData.get("payment_terms_days")?.toString() ?? "30") || 30;

  const { error } = await supabase
    .from("packages")
    .update({
      allowed_splits: splits.length ? splits : [1, 2, 3],
      payment_terms: terms === "net_days_after" ? "net_days_after" : "days_before",
      payment_terms_days: days,
    })
    .eq("id", packageId);
  if (error) throw new Error(error.message);
  revalidatePath("/packages");
}
