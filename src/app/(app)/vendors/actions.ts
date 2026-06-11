"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function socialCollab(v: FormDataEntryValue | null): string | null {
  const s = clean(v);
  return s === "collab" || s === "tag" || s === "either" ? s : null;
}

export async function createVendorCategory(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("vendor_categories").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
}

export async function toggleVendorCategory(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_categories").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
}

function vendorPayload(formData: FormData) {
  return {
    company_name: clean(formData.get("company_name")) ?? "Unnamed Vendor",
    category_id: clean(formData.get("category_id")),
    is_preferred: formData.get("is_preferred") === "on",
    website: clean(formData.get("website")),
    instagram: clean(formData.get("instagram")),
    tiktok: clean(formData.get("tiktok")),
    youtube: clean(formData.get("youtube")),
    social_collab: socialCollab(formData.get("social_collab")),
    notes: clean(formData.get("notes")),
  };
}

export async function createVendor(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .insert(vendorPayload(formData))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
  redirect(`/vendors/${data.id}`);
}

export async function updateVendor(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("vendors").update(vendorPayload(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
}

export async function addVendorContact(vendorId: string, formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("vendor_contacts").insert({
    vendor_id: vendorId,
    name,
    role: clean(formData.get("role")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${vendorId}`);
}

export async function removeVendorContact(vendorId: string, contactId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_contacts").delete().eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/vendors/${vendorId}`);
}
