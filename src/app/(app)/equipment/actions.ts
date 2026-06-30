"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createEquipmentItem(formData: FormData) {
  await requireModule("equipment", "edit", { mode: "throw" });
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
  await requireModule("equipment", "edit", { mode: "throw" });
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
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_items")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      category: clean(formData.get("category")),
      system_id: clean(formData.get("system_id")),
      notes: clean(formData.get("notes")),
      date_purchased: clean(formData.get("date_purchased")),
      retailer: clean(formData.get("retailer")),
      serial_number: clean(formData.get("serial_number")),
      storage_location_id: clean(formData.get("storage_location_id")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
  revalidatePath(`/equipment/item/${id}`);
}

async function actorName(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "system";
  const { data: emp } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (emp) return `${emp.first_name} ${emp.last_name}`.trim();
  return user.email ?? "user";
}

export async function reportDamage(itemId: string, formData: FormData) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const description = clean(formData.get("description"));
  if (!description) return;
  const { data: report, error } = await supabase
    .from("equipment_damage_reports")
    .insert({
      item_id: itemId,
      description,
      reported_by: await actorName(supabase),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const file = formData.get("photo") as File | null;
  if (file && file.size > 0) {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `damage/${report.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("equipment")
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
    if (!uploadError) {
      await supabase.from("equipment_photos").insert({
        damage_report_id: report.id,
        storage_path: path,
      });
    }
  }
  revalidatePath(`/equipment/item/${itemId}`);
  revalidatePath("/equipment");
}

export async function addDamagePhoto(itemId: string, reportId: string, formData: FormData) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `damage/${reportId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("equipment")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  await supabase.from("equipment_photos").insert({ damage_report_id: reportId, storage_path: path });
  revalidatePath(`/equipment/item/${itemId}`);
}

export async function resolveDamage(itemId: string, reportId: string) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_damage_reports")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", reportId);
  if (error) throw new Error(error.message);
  revalidatePath(`/equipment/item/${itemId}`);
  revalidatePath("/equipment");
}

export async function createStorageLocation(formData: FormData) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("equipment_storage_locations").insert({
    name,
    notes: clean(formData.get("notes")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}

export async function toggleStorageLocation(id: string, isActive: boolean) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_storage_locations")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
}

export async function uploadEquipmentPhoto(
  kind: "item" | "system",
  id: string,
  formData: FormData
) {
  await requireModule("equipment", "edit", { mode: "throw" });
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
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  await supabase.storage.from("equipment").remove([path]);
  const { error } = await supabase.from("equipment_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
  revalidatePath(`/equipment/${kind}/${ownerId}`);
  revalidatePath("/equipment");
}

export async function setItemSystem(itemId: string, systemId: string | null, revalidate: string) {
  await requireModule("equipment", "edit", { mode: "throw" });
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
  await requireModule("equipment", "edit", { mode: "throw" });
  const itemId = clean(formData.get("item_id"));
  if (!itemId) return;
  await setItemSystem(itemId, systemId, `/equipment/system/${systemId}`);
}

export async function updateEquipmentSystem(id: string, formData: FormData) {
  await requireModule("equipment", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_systems")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      description: clean(formData.get("description")),
      storage_location_id: clean(formData.get("storage_location_id")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/equipment");
  revalidatePath(`/equipment/system/${id}`);
}
