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
  revalidatePath(`/equipment/item/${id}`);
}

export async function uploadEquipmentPhoto(
  kind: "item" | "system",
  id: string,
  formData: FormData
) {
  const supabase = await createClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${kind}/${id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("equipment")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.from("equipment_photos").insert({
    item_id: kind === "item" ? id : null,
    system_id: kind === "system" ? id : null,
    storage_path: path,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/equipment/${kind}/${id}`);
  revalidatePath("/equipment");
}

export async function deleteEquipmentPhoto(
  kind: "item" | "system",
  ownerId: string,
  photoId: string,
  path: string
) {
  const supabase = await createClient();
  await supabase.storage.from("equipment").remove([path]);
  const { error } = await supabase.from("equipment_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
  revalidatePath(`/equipment/${kind}/${ownerId}`);
  revalidatePath("/equipment");
}

export async function setItemSystem(itemId: string, systemId: string | null, revalidate: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_items")
    .update({ system_id: systemId })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath(revalidate);
  revalidatePath("/equipment");
}

export async function addItemToSystemForm(systemId: string, formData: FormData) {
  const itemId = clean(formData.get("item_id"));
  if (!itemId) return;
  await setItemSystem(itemId, systemId, `/equipment/system/${systemId}`);
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
  revalidatePath(`/equipment/system/${id}`);
}
