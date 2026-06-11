"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createVendor(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .insert({
      company_name: clean(formData.get("company_name")) ?? "Unnamed Vendor",
      category: clean(formData.get("category")),
      notes: clean(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/vendors");
  redirect(`/vendors/${data.id}`);
}

export async function updateVendor(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("vendors")
    .update({
      company_name: clean(formData.get("company_name")) ?? "Unnamed Vendor",
      category: clean(formData.get("category")),
      notes: clean(formData.get("notes")),
    })
    .eq("id", id);
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
