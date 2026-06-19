import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import Tabs from "@/components/Tabs";
import { DOC_TYPES } from "@/lib/documentBlocks";
import { createTemplate, duplicateTemplate, deleteTemplate, generateDocument } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  final: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  sent: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  signed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  void: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export default async function DocumentsPage() {
  const supabase = await createClient();
  const [{ data: templates, error }, { data: docs }, { data: events }] = await Promise.all([
    supabase.from("document_templates").select("*").eq("is_active", true).order("name"),
    supabase
      .from("documents")
      .select("*, event:events(id, name, event_date, client:clients(first_name, last_name))")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("events")
      .select("id, name, event_date, client:clients(first_name, last_name)")
      .order("event_date", { ascending: false })
      .limit(200),
  ]);

  if (error) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Documents</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00034_documents.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const templatesTab = (
        <div>
          <h2 className="card-title">Templates</h2>
          <div className="card overflow-hidden">
            {(templates ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-t border-zinc-100 px-4 py-3 first:border-t-0 dark:border-white/[0.05]">
                <div className="min-w-0 flex-1">
                  <Link href={`/documents/templates/${t.id}`} className="font-semibold text-brand hover:underline dark:text-brand-lighter">
                    {t.name}
                  </Link>
                  <span className="ml-2 rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                    {t.doc_type}
                  </span>
                </div>
                <form action={duplicateTemplate.bind(null, t.id)}>
                  <button className="text-xs font-semibold text-zinc-500 hover:underline">Duplicate</button>
                </form>
                <form action={deleteTemplate.bind(null, t.id)}>
                  <button className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400">Delete</button>
                </form>
              </div>
            ))}
            {(templates ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">No templates yet — create your first below.</p>
            )}
          </div>
          <form action={createTemplate} className="card mt-3 flex flex-wrap items-end gap-2 p-4">
            <div className="min-w-44 flex-1">
              <label className="label-xs">New Template Name</label>
              <input name="name" required placeholder="e.g. Wedding Booking Agreement" className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Type</label>
              <select name="doc_type" className="input">
                {DOC_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <SaveButton className="btn-primary px-5 py-2 text-xs" savedLabel="Added">+ Create Template</SaveButton>
          </form>
        </div>
  );

  const generateTab = (
      <div className="space-y-6">
        <div>
          <h2 className="card-title">Generate A Document</h2>
          <form action={generateDocument} className="card space-y-3 p-4">
            <div>
              <label className="label-xs">Template</label>
              <select name="template_id" required className="input w-full">
                <option value="">Select template…</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs">Event</label>
              <select name="event_id" required className="input w-full">
                <option value="">Select event…</option>
                {(events ?? []).map((e) => {
                  const c = e.client as unknown as { first_name: string; last_name: string } | null;
                  return (
                    <option key={e.id} value={e.id}>
                      {e.name || "(unnamed)"}{c ? ` — ${c.first_name} ${c.last_name}` : ""}{e.event_date ? ` (${e.event_date})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <p className="text-xs text-zinc-500">
              Merge tags fill in, the fee table uses the event&apos;s <strong>pinned package version</strong>, and the
              result is frozen — template edits never change generated documents.
            </p>
            <SaveButton savedLabel="Done">Generate Document</SaveButton>
          </form>
        </div>

        <div>
        <h2 className="card-title">Generated Documents</h2>
        <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Document</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {(docs ?? []).map((d) => {
              const ev = d.event as unknown as { id: string; name: string; event_date: string | null; client: { first_name: string; last_name: string } | null } | null;
              return (
                <tr key={d.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                  <td className="px-4 py-2.5">
                    <Link href={`/documents/${d.id}`} className="font-medium text-brand hover:underline dark:text-brand-lighter">
                      {d.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {ev ? (
                      <Link href={`/events/${ev.id}`} className="text-zinc-600 hover:underline dark:text-zinc-400">
                        {ev.name || "(unnamed)"}{ev.event_date ? ` · ${ev.event_date}` : ""}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[d.status] ?? STATUS_STYLES.draft}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {(docs ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No documents generated yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        </div>
      </div>
  );

  return (
    <div className="max-w-6xl">
      <h1 className="page-title mb-5">Documents</h1>
      <Tabs
        tabs={[
          { id: "templates", label: "Templates", badge: (templates ?? []).length || undefined, content: templatesTab },
          { id: "generate", label: "Generate & History", badge: (docs ?? []).length || undefined, content: generateTab },
        ]}
      />
    </div>
  );
}
