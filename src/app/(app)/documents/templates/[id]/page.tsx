import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentBuilder from "@/components/DocumentBuilder";
import { CheckBoxField } from "@/components/SettingsForm";
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

  const tpl = template as typeof template & {
    fresh_on_attach?: boolean;
    pdf_filename?: string | null;
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <Link href="/documents" className="text-xs font-semibold text-zinc-500 hover:underline">← Documents</Link>
        <h1 className="page-title mt-1">{template.name}</h1>
        <p className="text-sm text-zinc-500">
          Write the content. XOS applies the branded design when documents are generated. Use merge tags in text
          blocks; smart blocks pull live event data. Logo, accent color, and footer text are editable in{" "}
          <Link href="/settings/general" className="font-semibold text-brand underline dark:text-brand-lighter">
            Settings → General
          </Link>
          .
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

          {/* PDF attach settings (used when an email template attaches this doc as PDF) */}
          <div className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-2 dark:border-white/[0.06]">
            <div>
              <label className="label-xs">PDF Attachment Filename</label>
              <input
                name="pdf_filename"
                defaultValue={tpl.pdf_filename ?? ""}
                placeholder="Xpress Receipt - &lt;event_number&gt;"
                className="input w-full"
              />
              <p className="mt-1 text-[11px] text-zinc-400">
                Merge tags allowed. Used when an email attaches this template as a PDF. Blank uses the document title.
              </p>
            </div>
            <div className="flex flex-col justify-end">
              <CheckBoxField
                name="fresh_on_attach"
                label="Always generate a fresh PDF on send"
                defaultChecked={tpl.fresh_on_attach ?? false}
              />
              <p className="mt-1 text-[11px] text-zinc-400">
                Turn on for receipts so each payment freezes current amounts. Leave off for signed booking agreements
                (those prefer the latest signed copy).
              </p>
            </div>
          </div>
        </div>

        <DocumentBuilder initial={sanitizeBlocks(template.blocks)} mode="template" />
      </form>
    </div>
  );
}
