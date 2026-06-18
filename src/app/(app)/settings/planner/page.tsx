import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import { createTemplate } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlannerTemplatesPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: eventTypes }] = await Promise.all([
    supabase
      .from("planning_templates")
      .select("id, name, is_default, event_type:event_types(name)")
      .order("name"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
  ]);

  // Section counts per template (one cheap grouped read).
  const ids = (templates ?? []).map((t) => t.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: secs } = await supabase
      .from("planning_template_sections")
      .select("template_id")
      .in("template_id", ids);
    for (const s of secs ?? []) counts.set(s.template_id, (counts.get(s.template_id) ?? 0) + 1);
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title mb-1">XOS Planner — Templates</h1>
        <p className="text-sm text-zinc-500">
          Build reusable section &amp; question sets for the client planner. A template is assigned to an event by a
          Booking Helper (or by event type / default). e.g. <strong>Villa Toscana — Wedding</strong>.
        </p>
      </div>

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
}
