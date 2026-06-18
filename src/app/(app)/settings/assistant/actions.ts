"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** KB editing is Master-Admin-only while the assistant is in training. */
async function requireMaster(supabase: Awaited<ReturnType<typeof createClient>>) {
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") {
    throw new Error("Not authorized.");
  }
}

export async function createArticle(formData: FormData) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const title = clean(formData.get("title"));
  if (!title) return;
  const { error } = await supabase.from("kb_articles").insert({
    title,
    content: (formData.get("content") ?? "").toString(),
    category: clean(formData.get("category")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/assistant");
}

export async function updateArticle(id: string, formData: FormData) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const { error } = await supabase
    .from("kb_articles")
    .update({
      title: clean(formData.get("title")) ?? "",
      category: clean(formData.get("category")),
      content: (formData.get("content") ?? "").toString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/assistant");
}

export async function toggleArticle(id: string, isActive: boolean) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const { error } = await supabase.from("kb_articles").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/assistant");
}

export async function deleteArticle(id: string) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const { error } = await supabase.from("kb_articles").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/assistant");
}
