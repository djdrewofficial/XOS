"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createClientRole(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const sort = parseInt((formData.get("sort_order") ?? "0").toString(), 10) || 0;
  const { error } = await supabase.from("client_role_definitions").insert({ name, sort_order: sort });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}

export async function updateClientRole(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_role_definitions")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      sort_order: parseInt((formData.get("sort_order") ?? "0").toString(), 10) || 0,
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}

export async function createEventType(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("event_types").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}

export async function updateEventType(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_types")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}
