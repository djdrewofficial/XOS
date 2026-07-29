"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function createClientRole(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const sort = parseInt((formData.get("sort_order") ?? "0").toString(), 10) || 0;
  const { error } = await supabase.from("client_role_definitions").insert({ name, sort_order: sort });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}

export async function updateClientRole(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
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
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const { error } = await supabase.from("event_types").insert({ name });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/custom-fields");
}

export async function updateEventType(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
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

// ─────────────────────── File labels ───────────────────────

function slugify(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Create a file label + its <document_slug> email-attach merge tag. The slug is
    fixed at creation so renaming never breaks a tag already used in templates. */
export async function createFileLabel(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name"));
  if (!name) return;
  const slug = slugify(name);
  if (!slug) throw new Error("Label needs at least one letter or number.");
  const sort = parseInt((formData.get("sort_order") ?? "0").toString(), 10) || 0;

  const { error } = await supabase.from("file_label_definitions").insert({ name, slug, sort_order: sort });
  if (error) throw new Error(error.code === "23505" ? "A label with a similar name already exists." : error.message);

  await supabase.from("merge_tags").upsert(
    {
      tag_key: `document_${slug}`,
      label: `Attach: ${name} files`,
      group_name: "Files",
      description: `Attaches all files labeled "${name}" to the email (large files become download links).`,
      is_builtin: true,
      source_type: "attachment",
      is_active: true,
    },
    { onConflict: "tag_key" },
  );
  revalidatePath("/settings/custom-fields");
}

export async function updateFileLabel(id: string, formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  const supabase = await createClient();
  const name = clean(formData.get("name")) ?? "Unnamed";
  const isActive = formData.get("is_active") === "on";
  const { data: before } = await supabase.from("file_label_definitions").select("slug").eq("id", id).maybeSingle();

  const { error } = await supabase
    .from("file_label_definitions")
    .update({
      name,
      sort_order: parseInt((formData.get("sort_order") ?? "0").toString(), 10) || 0,
      is_active: isActive,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // keep the merge tag's display + active state in sync (tag_key/slug unchanged)
  if (before?.slug) {
    await supabase
      .from("merge_tags")
      .update({ label: `Attach: ${name} files`, description: `Attaches all files labeled "${name}" to the email (large files become download links).`, is_active: isActive })
      .eq("tag_key", `document_${before.slug}`);
  }
  revalidatePath("/settings/custom-fields");
}
