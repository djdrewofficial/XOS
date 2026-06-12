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
  const { data: template } = await supabase.from("document_templates").select("*").eq("id", id).single();
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
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
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
        </div>

        <DocumentBuilder initial={sanitizeBlocks(template.blocks)} mode="template" />
      </form>
    </div>
  );
}
