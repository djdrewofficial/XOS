"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function payload(formData: FormData) {
  return {
    first_name: clean(formData.get("first_name")) ?? "",
    last_name: clean(formData.get("last_name")) ?? "",
    organization: clean(formData.get("organization")),
    cell_phone: clean(formData.get("cell_phone")),
    email: clean(formData.get("email")),
    mailing_address: clean(formData.get("mailing_address")),
    notes: clean(formData.get("notes")),
  };
}

export async function createClientRecord(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert(payload(formData))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  redirect(`/clients/${data.id}`);
}

export async function updateClientRecord(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(payload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}
