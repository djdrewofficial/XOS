"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createEquipmentItem(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("equipment_items").insert({
    name,
    category: clean(formData.get("category")),
    system_id: clean(formData.get("system_id")),
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}

export async function createEquipmentSystem(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("equipment_systems").insert({
    name,
    description: clean(formData.get("description")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}

export async function updateEquipmentItem(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_items")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      category: clean(formData.get("category")),
      system_id: clean(formData.get("system_id")),
      notes: clean(formData.get("notes")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}

export async function updateEquipmentSystem(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_systems")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      description: clean(formData.get("description")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}
