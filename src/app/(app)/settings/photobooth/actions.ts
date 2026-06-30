"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe, requireModule } from "@/lib/auth";

/* Photo Booth backdrop gallery — staff curate the swipeable backdrops the couple
   picks from in the planner. Images live in the public `photobooth-backdrops`
   bucket; rows in photobooth_backdrops (staff-manage RLS). */

const BUCKET = "photobooth-backdrops";

async function requireStaff() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff") throw new Error("Staff only");
  return supabase;
}

const rev = () => revalidatePath("/settings/photobooth");

export async function uploadBackdrop(formData: FormData) {
  await requireModule("settings", "edit", { mode: "throw" });
  await requireStaff();
  const file = formData.get("photo") as File | null;
  const name = (formData.get("name") ?? "").toString().trim() || "Backdrop";
  const category = (formData.get("category") ?? "").toString().trim() || null;
  if (!file || file.size === 0) return { ok: false, error: "Choose an image" };
  if (file.size > 12 * 1024 * 1024) return { ok: false, error: "Image too large (max 12MB)" };

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: true });
  if (upErr) return { ok: false, error: upErr.message };

  const image_url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Append to the end of the gallery.
  const { data: last } = await admin
    .from("photobooth_backdrops")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (last?.sort_order ?? -1) + 1;

  const { error } = await admin
    .from("photobooth_backdrops")
    .insert({ name, category, image_path: path, image_url, sort_order });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function updateBackdrop(id: string, patch: { name?: string; category?: string | null }) {
  await requireModule("settings", "edit", { mode: "throw" });
  await requireStaff();
  const admin = createAdminClient();
  const { error } = await admin.from("photobooth_backdrops").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function toggleBackdrop(id: string, isActive: boolean) {
  await requireModule("settings", "edit", { mode: "throw" });
  await requireStaff();
  const admin = createAdminClient();
  const { error } = await admin.from("photobooth_backdrops").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  rev();
}

export async function deleteBackdrop(id: string) {
  await requireModule("settings", "edit", { mode: "throw" });
  await requireStaff();
  const admin = createAdminClient();
  const { data: row } = await admin.from("photobooth_backdrops").select("image_path").eq("id", id).maybeSingle();
  if (row?.image_path) await admin.storage.from(BUCKET).remove([row.image_path]);
  const { error } = await admin.from("photobooth_backdrops").delete().eq("id", id);
  if (error) throw new Error(error.message);
  rev();
}

export async function reorderBackdrops(orderedIds: string[]) {
  await requireModule("settings", "edit", { mode: "throw" });
  await requireStaff();
  const admin = createAdminClient();
  await Promise.all(
    orderedIds.map((id, i) => admin.from("photobooth_backdrops").update({ sort_order: i }).eq("id", id)),
  );
  rev();
}
