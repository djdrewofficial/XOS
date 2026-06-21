import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import Tabs from "@/components/Tabs";
import TemplateBuilder, { type BuilderSection, type BuilderTemplate } from "@/components/planner/TemplateBuilder";
import { createTemplate } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlannerTemplatesPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: eventTypes }, { data: library }] = await Promise.all([
    supabase
      .from("planning_templates")
      .select("id, name, is_default, event_type:event_types(name)")
      .eq("is_library", false)
      .order("name"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("planning_templates").select("*").eq("is_library", true).maybeSingle(),
  ]);

  // Section counts per event template (one cheap grouped read).
  const ids = (templates ?? []).map((t) => t.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: secs } = await supabase
      .from("planning_template_sections")
      .select("template_id")
      .in("template_id", ids);
    for (const s of secs ?? []) counts.set(s.template_id, (counts.get(s.template_id) ?? 0) + 1);
  }

  // ---- Section Templates library (reuses the template builder) ----
  let librarySections: BuilderSection[] = [];
  if (library?.id) {
    const [{ data: secs }, { data: qs }] = await Promise.all([
      supabase.from("planning_template_sections").select("*").eq("template_id", library.id).order("sort_order"),
      supabase
        .from("planning_template_questions")
        .select("*, planning_template_sections!inner(template_id)")
        .eq("planning_template_sections.template_id", library.id)
        .order("sort_order"),
    ]);
    const qBySection = new Map<string, BuilderSection["questions"]>();
    for (const q of qs ?? []) {
      const list = qBySection.get(q.template_section_id) ?? [];
      list.push({
        id: q.id,
        prompt: q.prompt,
        help_text: q.help_text ?? null,
        answer_type: q.answer_type,
        options: Array.isArray(q.options) ? q.options : [],
        required: q.required,
        condition_question_id: q.condition_question_id ?? null,
        condition_values: Array.isArray(q.condition_values) ? q.condition_values : [],
      });
      qBySection.set(q.template_section_id, list);
    }
    librarySections = (secs ?? []).map((s) => ({
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
  }
  const libraryTemplate: BuilderTemplate | null = library
    ? { id: library.id, name: library.name, event_type_id: null, is_default: false }
    : null;

  const eventTemplatesTab = (
    <div>
      <div className="card mb-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2.5 text-left">Template</th>
              <th className="px-4 py-2.5 text-left">Event Type</th>
              <th className="px-3 py-2.5 text-center">Sections</th>
              <th className="px-3 py-2.5 text-center">Default</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {(templates ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">No templates yet — create one below.</td>
              </tr>
            )}
            {(templates ?? []).map((t) => (
              <tr key={t.id} className="border-t border-zinc-100 dark:border-white/[0.06]">
                <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-100">{t.name}</td>
                <td className="px-4 py-3 text-zinc-500">
                  {(t.event_type as { name?: string } | null)?.name ?? "—"}
                </td>
                <td className="px-3 py-3 text-center text-zinc-500">{counts.get(t.id) ?? 0}</td>
                <td className="px-3 py-3 text-center">
                  {t.is_default && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:text-brand-lighter">Default</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/settings/planner/${t.id}`} className="font-semibold text-brand hover:underline dark:text-brand-lighter">
                    Edit →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h2 className="card-title mb-3">New Template</h2>
        <form action={createTemplate} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-50">
            <label className="mb-1 block text-xs font-medium text-zinc-500">Name</label>
            <input name="name" required placeholder="Villa Toscana — Wedding" className="input w-full" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Event Type (optional)</label>
            <select name="event_type_id" className="input">
              <option value="">— Any —</option>
              {(eventTypes ?? []).map((et) => (
                <option key={et.id} value={et.id}>{et.name}</option>
              ))}
            </select>
          </div>
          <SaveButton savedLabel="Created">+ Create Template</SaveButton>
        </form>
      </div>
    </div>
  );

  const sectionTemplatesTab = libraryTemplate ? (
    <div>
      <p className="mb-4 text-sm text-zinc-500">
        Reusable sections you can drop onto any event — on demand, or automatically when a matching add-on is attached
        (set that on the add-on&apos;s <strong>Planning Sections</strong> tab, e.g. Photo Booth → &ldquo;Your Photo-booth Xperience&rdquo;).
        These never seed onto an event by themselves.
      </p>
      <TemplateBuilder template={libraryTemplate} sections={librarySections} eventTypes={[]} library />
    </div>
  ) : (
    <p className="text-sm text-zinc-500">Run migration 00100 to enable the Section Templates library.</p>
  );

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title mb-1">XOS Planner</h1>
        <p className="text-sm text-zinc-500">
          Build reusable section &amp; question sets for the client planner.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: "templates", label: "Event Templates", content: eventTemplatesTab },
          { id: "sections", label: "Section Templates", badge: librarySections.length || undefined, content: sectionTemplatesTab },
        ]}
      />
    </div>
  );
}
