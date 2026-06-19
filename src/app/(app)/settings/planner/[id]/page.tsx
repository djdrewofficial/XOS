import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TemplateBuilder, { type BuilderSection, type BuilderTemplate } from "@/components/planner/TemplateBuilder";

export const dynamic = "force-dynamic";

export default async function TemplateBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: template }, { data: eventTypes }, { data: sections }, { data: questions }] = await Promise.all([
    supabase.from("planning_templates").select("*").eq("id", id).maybeSingle(),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("planning_template_sections").select("*").eq("template_id", id).order("sort_order"),
    supabase
      .from("planning_template_questions")
      .select("*, planning_template_sections!inner(template_id)")
      .eq("planning_template_sections.template_id", id)
      .order("sort_order"),
  ]);

  if (!template) notFound();

  const qBySection = new Map<string, BuilderSection["questions"]>();
  for (const q of questions ?? []) {
    const list = qBySection.get(q.template_section_id) ?? [];
    list.push({
      id: q.id,
      prompt: q.prompt,
      answer_type: q.answer_type,
      options: Array.isArray(q.options) ? q.options : [],
      required: q.required,
      condition_question_id: q.condition_question_id ?? null,
      condition_values: Array.isArray(q.condition_values) ? q.condition_values : [],
    });
    qBySection.set(q.template_section_id, list);
  }

  const builderSections: BuilderSection[] = (sections ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    icon: s.icon,
    section_type: s.section_type,
    intro: s.intro,
    guest_enabled: s.guest_enabled,
    songs_enabled: s.songs_enabled,
    questions_enabled: s.questions_enabled,
    notes_enabled: s.notes_enabled,
    time_enabled: s.time_enabled,
    ai_picks_enabled: s.ai_picks_enabled,
    song_limit: s.song_limit,
    must_play_limit: s.must_play_limit,
    module: s.module ?? null,
    questions: qBySection.get(s.id) ?? [],
  }));

  const builderTemplate: BuilderTemplate = {
    id: template.id,
    name: template.name,
    event_type_id: template.event_type_id,
    is_default: template.is_default,
  };

  return (
    <div className="max-w-4xl">
      <Link href="/settings/planner" className="mb-3 inline-block text-sm text-zinc-500 hover:text-brand">
        ← All templates
      </Link>
      <TemplateBuilder
        template={builderTemplate}
        sections={builderSections}
        eventTypes={(eventTypes ?? []) as { id: string; name: string }[]}
      />
    </div>
  );
}
