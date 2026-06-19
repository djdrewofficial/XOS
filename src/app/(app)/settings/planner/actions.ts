"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe } from "@/lib/auth";

/* Planning template builder — staff-only (planning_template_* tables have
   staff-manage RLS, so the user client works; uploads use admin). */

async function staffClient() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff") throw new Error("Staff only");
  return supabase;
}

const rev = (id?: string) => {
  revalidatePath("/settings/planner");
  if (id) revalidatePath(`/settings/planner/${id}`);
};

// ───────────────────────── Templates ─────────────────────────

export async function createTemplate(formData: FormData) {
  const supabase = await staffClient();
  const name = (formData.get("name") ?? "").toString().trim() || "New Template";
  const eventTypeId = (formData.get("event_type_id") ?? "").toString().trim() || null;
  const { data, error } = await supabase
    .from("planning_templates")
    .insert({ name, event_type_id: eventTypeId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/settings/planner/${data.id}`);
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; event_type_id?: string | null },
) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_templates").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(id);
  return { ok: true };
}

export async function setDefaultTemplate(id: string, isDefault: boolean) {
  const supabase = await staffClient();
  if (isDefault) await supabase.from("planning_templates").update({ is_default: false }).neq("id", id);
  const { error } = await supabase.from("planning_templates").update({ is_default: isDefault }).eq("id", id);
  if (error) throw new Error(error.message);
  rev(id);
}

export async function deleteTemplate(id: string) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/planner");
  redirect("/settings/planner");
}

export async function duplicateTemplate(id: string) {
  const supabase = await staffClient();
  const admin = createAdminClient();
  const { data: tpl } = await admin.from("planning_templates").select("*").eq("id", id).single();
  if (!tpl) throw new Error("Template not found");
  const { data: copy } = await admin
    .from("planning_templates")
    .insert({ name: `${tpl.name} (copy)`, event_type_id: tpl.event_type_id, is_default: false })
    .select("id")
    .single();
  if (!copy) throw new Error("Could not copy");

  const { data: secs } = await admin.from("planning_template_sections").select("*").eq("template_id", id).order("sort_order");
  for (const s of secs ?? []) {
    const { data: ns } = await admin
      .from("planning_template_sections")
      .insert({
        template_id: copy.id,
        title: s.title, icon: s.icon, section_type: s.section_type, intro: s.intro, time_label: s.time_label,
        client_editable: s.client_editable, guest_enabled: s.guest_enabled, song_limit: s.song_limit,
        must_play_limit: s.must_play_limit, songs_enabled: s.songs_enabled, questions_enabled: s.questions_enabled,
        notes_enabled: s.notes_enabled, time_enabled: s.time_enabled, ai_picks_enabled: s.ai_picks_enabled,
        section_cover_url: s.section_cover_url, permissions: s.permissions, sort_order: s.sort_order,
      })
      .select("id")
      .single();
    if (!ns) continue;
    const { data: qs } = await admin.from("planning_template_questions").select("*").eq("template_section_id", s.id).order("sort_order");
    if (qs?.length) {
      await admin.from("planning_template_questions").insert(
        qs.map((q) => ({
          template_section_id: ns.id, prompt: q.prompt, help_text: q.help_text,
          answer_type: q.answer_type, options: q.options, required: q.required, sort_order: q.sort_order,
        })),
      );
    }
  }
  revalidatePath("/settings/planner");
  redirect(`/settings/planner/${copy.id}`);
}

// ───────────────────────── Sections ─────────────────────────

type TSectionPatch = {
  title?: string;
  icon?: string | null;
  intro?: string | null;
  section_type?: "info" | "timeline" | "headline";
  guest_enabled?: boolean;
  songs_enabled?: boolean;
  questions_enabled?: boolean;
  notes_enabled?: boolean;
  time_enabled?: boolean;
  ai_picks_enabled?: boolean;
  song_limit?: number | null;
  must_play_limit?: number | null;
  module?: string | null;
};

export async function addTemplateSection(
  templateId: string,
  input?: { title?: string; icon?: string; section_type?: "timeline" | "headline" },
) {
  const supabase = await staffClient();
  const { data: last } = await supabase
    .from("planning_template_sections")
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("planning_template_sections").insert({
    template_id: templateId,
    title: input?.title?.trim() || (input?.section_type === "headline" ? "New Group" : "New Section"),
    icon: input?.icon?.trim() || null,
    section_type: input?.section_type || "timeline",
    songs_enabled: input?.section_type !== "headline",
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  rev(templateId);
  return { ok: true };
}

export async function updateTemplateSection(templateId: string, sectionId: string, patch: TSectionPatch) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_template_sections").update(patch).eq("id", sectionId);
  if (error) return { ok: false, error: error.message };
  rev(templateId);
  return { ok: true };
}

export async function deleteTemplateSection(templateId: string, sectionId: string) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_template_sections").delete().eq("id", sectionId);
  if (error) throw new Error(error.message);
  rev(templateId);
}

export async function reorderTemplateSections(templateId: string, orderedIds: string[]) {
  const supabase = await staffClient();
  await Promise.all(
    orderedIds.map((id, i) => supabase.from("planning_template_sections").update({ sort_order: i }).eq("id", id)),
  );
  rev(templateId);
}

// ───────────────────────── Questions ─────────────────────────

type QOption = string | { label: string; image?: string | null };

export async function addTemplateQuestion(
  templateId: string,
  sectionId: string,
  q: { prompt: string; answer_type: string; options?: QOption[]; help_text?: string; required?: boolean; condition_question_id?: string | null; condition_values?: string[] },
) {
  const supabase = await staffClient();
  const { data: last } = await supabase
    .from("planning_template_questions")
    .select("sort_order")
    .eq("template_section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("planning_template_questions").insert({
    template_section_id: sectionId,
    prompt: q.prompt,
    answer_type: q.answer_type,
    options: q.options ?? [],
    help_text: q.help_text ?? null,
    required: q.required ?? false,
    sort_order: (last?.sort_order ?? -1) + 1,
    condition_question_id: q.condition_question_id ?? null,
    condition_values: q.condition_values ?? [],
  });
  if (error) return { ok: false, error: error.message };
  rev(templateId);
  return { ok: true };
}

export async function updateTemplateQuestion(
  templateId: string,
  questionId: string,
  patch: { prompt?: string; options?: QOption[]; required?: boolean; help_text?: string | null; condition_question_id?: string | null; condition_values?: string[] },
) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_template_questions").update(patch).eq("id", questionId);
  if (error) return { ok: false, error: error.message };
  rev(templateId);
  return { ok: true };
}

export async function deleteTemplateQuestion(templateId: string, questionId: string) {
  const supabase = await staffClient();
  const { error } = await supabase.from("planning_template_questions").delete().eq("id", questionId);
  if (error) throw new Error(error.message);
  rev(templateId);
}

/** Upload an option image (for image_select questions) to the planning-assets
    bucket and return its public URL. The client then patches the question's
    options with the returned URL. */
export async function uploadOptionImage(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  await staffClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "Image too large (max 8MB)" };
  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `options/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage
    .from("planning-assets")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: admin.storage.from("planning-assets").getPublicUrl(path).data.publicUrl };
}
