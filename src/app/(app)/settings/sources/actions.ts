"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createSource(formData: FormData) {
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("inquiry_sources").insert({
    name,
    venue_id: clean(formData.get("venue_id")),
    vendor_id: clean(formData.get("vendor_id")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/sources");
}

export async function updateSource(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("inquiry_sources")
    .update({
      name: clean(formData.get("name")) ?? "Unnamed",
      venue_id: clean(formData.get("venue_id")),
      vendor_id: clean(formData.get("vendor_id")),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/sources");
}
