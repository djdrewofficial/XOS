"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createEmployee(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({
    first_name: clean(formData.get("first_name")) ?? "",
    last_name: clean(formData.get("last_name")) ?? "",
    email: clean(formData.get("email")),
    phone: clean(formData.get("phone")),
    permission_tier: clean(formData.get("permission_tier")) ?? "employee",
    hourly_rate: formData.get("hourly_rate")
      ? parseFloat(formData.get("hourly_rate")!.toString())
      : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

export async function toggleEmployee(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}
