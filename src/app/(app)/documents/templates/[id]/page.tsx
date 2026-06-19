import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentBuilder from "@/components/DocumentBuilder";
import { DOC_TYPES, sanitizeBlocks } from "@/lib/documentBlocks";
import { updateTemplate } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DocumentTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: template }, { data: helpers }] = await Promise.all([
    supabase.from("document_templates").select("*").eq("id", id).single(),
    supabase.from("booking_helpers").select("id, title").eq("is_active", true).order("position"),
  ]);
  if (!template) notFound();

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <Link href="/documents" className="text-xs font-semibold text-zinc-500 hover:underline">← Documents</Link>
        <h1 className="page-title mt-1">{template.name}</h1>
        <p className="text-sm text-zinc-500">
          Write the content — XOS applies the branded design when documents are generated. Use merge tags in text
          blocks; smart blocks pull live event data.
        </p>
      </div>

      <form action={updateTemplate.bind(null, id)}>
        <div className="card mb-4 p-4">
          {/* Top bar: name + type, with Preview */}
          <div className="flex flex-wrap items-end gap-3 border-b border-zinc-100 pb-3 dark:border-white/[0.06]">
            <div className="min-w-52 flex-1">
              <label className="label-xs">Template Name</label>
              <input name="name" defaultValue={template.name} required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Type</label>
              <select name="doc_type" defaultValue={template.doc_type} className="input">
                {DOC_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <a
              href={`/documents/templates/${id}/preview`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
            >
              Preview ↗
            </a>
          </div>

          {/* After-sign settings */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-xs">After-Sign Forward URL (optional)</label>
              <input
                name="after_sign_url"
                type="url"
                defaultValue={template.after_sign_url ?? ""}
                placeholder="https://… — where the client goes after signing"
                className="input w-full"
              />
            </div>
            <div>
              <label className="label-xs">After-Sign Automation (optional)</label>
              <select name="after_sign_helper_id" defaultValue={template.after_sign_helper_id ?? ""} className="input w-full">
                <option value="">— None —</option>
                {(helpers ?? []).map((h) => (
                  <option key={h.id} value={h.id}>{h.title}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-zinc-400">
                Booking helper that runs automatically the moment the client signs.
              </p>
            </div>
          </div>
        </div>

        <DocumentBuilder initial={sanitizeBlocks(template.blocks)} mode="template" />
      </form>
    </div>
  );
}
