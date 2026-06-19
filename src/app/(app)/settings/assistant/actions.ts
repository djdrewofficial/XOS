"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe } from "@/lib/auth";
import { sendMorningBriefing } from "@/lib/morningBriefing";
import { runVendorMatching } from "@/lib/vendorMatch";

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

// ───────────────────────── Daily AI tasks ─────────────────────────

export async function saveAiTask(key: string, formData: FormData) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const enabled = formData.get("enabled") === "on";
  const hourRaw = Number(formData.get("hour"));
  const hour = Number.isFinite(hourRaw) ? Math.min(23, Math.max(0, Math.trunc(hourRaw))) : 7;
  const recipients = clean(formData.get("recipients"));
  const config: Record<string, unknown> = { hour };
  if (recipients) config.recipients = recipients;
  const { error } = await supabase
    .from("ai_tasks")
    .update({ enabled, config, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/assistant");
}

/** Run a task immediately (ignores enabled/schedule). Master-Admin only. */
export async function runAiTaskNow(key: string) {
  const supabase = await createClient();
  await requireMaster(supabase);
  const { data: t } = await supabase.from("ai_tasks").select("config").eq("key", key).maybeSingle();
  const cfg = (t?.config ?? {}) as { recipients?: string };
  const admin = createAdminClient();
  if (key === "morning_briefing") {
    await sendMorningBriefing(admin, cfg.recipients || "events@xpressdjs.com");
  } else if (key === "vendor_matching") {
    await runVendorMatching(admin);
  }
  revalidatePath("/settings/assistant");
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
