"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function normalizeKey(v: FormDataEntryValue | null): string {
  return (v ?? "").toString().trim().replace(/^<|>$/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function addCustomTag(formData: FormData) {
  const tag_key = normalizeKey(formData.get("tag_key"));
  if (!tag_key) throw new Error("Tag key is required.");
  const supabase = await createClient();
  const { error } = await supabase.from("merge_tags").upsert(
    {
      tag_key,
      label: clean(formData.get("label")) ?? tag_key,
      group_name: (clean(formData.get("group_name")) ?? "CUSTOM").toUpperCase(),
      description: clean(formData.get("description")),
      source_type: clean(formData.get("source_type")) ?? "static",
      source_value: clean(formData.get("source_value")),
      is_builtin: false,
      is_active: true,
    },
    { onConflict: "tag_key" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/settings/merge-tags");
}

export async function updateCustomTag(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("merge_tags")
    .update({
      label: clean(formData.get("label")),
      group_name: (clean(formData.get("group_name")) ?? "CUSTOM").toUpperCase(),
      description: clean(formData.get("description")),
      source_type: clean(formData.get("source_type")) ?? "static",
      source_value: clean(formData.get("source_value")),
      is_active: formData.get("is_active") !== "off",
    })
    .eq("id", id)
    .eq("is_builtin", false);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/merge-tags");
}

export async function deleteCustomTag(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("merge_tags").delete().eq("id", id).eq("is_builtin", false);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/merge-tags");
}
