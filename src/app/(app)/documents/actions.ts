"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sanitizeBlocks, type DocBlock } from "@/lib/documentBlocks";
import { renderBlocks, generateDocumentRow } from "@/lib/documentRender";
import { sendDocumentForSignature } from "@/lib/sendForSignature";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/** Rebuild the ordered block list from the builder: manifest carries order/type,
    each text block's html arrives via its rich-text editor's hidden input. */
function blocksFromForm(formData: FormData): DocBlock[] {
  let manifest: unknown = [];
  try {
    manifest = JSON.parse((formData.get("block_manifest") ?? "[]").toString());
  } catch {
    manifest = [];
  }
  return sanitizeBlocks(manifest).map((b) => {
    if (b.type === "text") {
      return { ...b, html: (formData.get(`block_html_${b.id}`) ?? "").toString() };
    }
    if (b.type === "section") {
      return {
        ...b,
        title: (formData.get(`block_title_${b.id}`) ?? "").toString(),
        html: (formData.get(`block_html_${b.id}`) ?? "").toString(),
      };
    }
    return b;
  });
}

/* ---------------- templates ---------------- */

export async function createTemplate(formData: FormData) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_templates")
    .insert({
      name: clean(formData.get("name")) ?? "New Document",
      doc_type: clean(formData.get("doc_type")) ?? "contract",
      blocks: [
        { id: crypto.randomUUID(), type: "event_details" },
        { id: crypto.randomUUID(), type: "text", html: "" },
        { id: crypto.randomUUID(), type: "fee_table" },
        { id: crypto.randomUUID(), type: "payment_schedule" },
        { id: crypto.randomUUID(), type: "signature" },
      ],
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/documents");
  redirect(`/documents/templates/${data.id}`);
}

export async function updateTemplate(id: string, formData: FormData) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_templates")
    .update({
      name: clean(formData.get("name")) ?? "Untitled",
      doc_type: clean(formData.get("doc_type")) ?? "contract",
      after_sign_url: clean(formData.get("after_sign_url")),
      after_sign_helper_id: clean(formData.get("after_sign_helper_id")),
      blocks: blocksFromForm(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/templates/${id}`);
  revalidatePath("/documents");
}

export async function duplicateTemplate(id: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: t, error } = await supabase.from("document_templates").select("*").eq("id", id).single();
  if (error || !t) throw new Error(error?.message ?? "Template not found");
  const { data: copy, error: insError } = await supabase
    .from("document_templates")
    .insert({ name: `${t.name} (copy)`, doc_type: t.doc_type, blocks: t.blocks })
    .select("id")
    .single();
  if (insError) throw new Error(insError.message);
  revalidatePath("/documents");
  redirect(`/documents/templates/${copy.id}`);
}

export async function deleteTemplate(id: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_templates")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/documents");
}

/* ---------------- generated documents ---------------- */

export async function generateDocument(formData: FormData) {
  await requireModule("documents", "edit", { mode: "throw" });
  const templateId = clean(formData.get("template_id"));
  const eventId = clean(formData.get("event_id"));
  if (!templateId || !eventId) return;

  const supabase = await createClient();
  const doc = await generateDocumentRow(supabase, templateId, eventId);
  if (!doc) throw new Error("Could not render document for this event");
  revalidatePath("/documents");
  revalidatePath(`/events/${eventId}`);
  redirect(`/documents/${doc.id}`);
}

export async function updateDocumentBlocks(id: string, formData: FormData) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  // one-off edits: text blocks editable; smart blocks keep their frozen html
  const { data: doc } = await supabase.from("documents").select("blocks, signed_at").eq("id", id).single();
  if (!doc) throw new Error("Document not found");
  if (doc.signed_at) throw new Error("Signed documents are locked.");

  const existing = new Map(sanitizeBlocks(doc.blocks).map((b) => [b.id, b]));
  const next = blocksFromForm(formData).map((b) =>
    b.type === "text" ? b : { ...b, html: existing.get(b.id)?.html ?? b.html }
  );

  const { error } = await supabase
    .from("documents")
    .update({ blocks: next, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

export async function regenerateDocument(id: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("event_id, template_id, signed_at")
    .eq("id", id)
    .single();
  if (!doc) throw new Error("Document not found");
  if (doc.signed_at) throw new Error("Signed documents are locked.");
  const { data: template } = await supabase
    .from("document_templates")
    .select("blocks")
    .eq("id", doc.template_id)
    .single();
  if (!template) throw new Error("Original template no longer exists");

  const rendered = await renderBlocks(supabase, doc.event_id, sanitizeBlocks(template.blocks));
  if (!rendered) throw new Error("Could not render document");
  const { error } = await supabase
    .from("documents")
    .update({ blocks: rendered, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/${id}`);
}

export async function setDocumentStatus(id: string, status: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

/** Emails the client their signing link and marks the document as sent. */
export async function sendForSignature(id: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const sent = await sendDocumentForSignature(supabase, id);
  revalidatePath(`/documents/${id}`);
  if (sent.eventId) revalidatePath(`/events/${sent.eventId}`);
  revalidatePath("/documents");
}

export async function setDocumentVisibility(id: string, eventId: string, visible: boolean) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ visible_to_client: visible, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/documents/${id}`);
}

export async function deleteDocument(id: string) {
  await requireModule("documents", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("signed_at").eq("id", id).single();
  if (doc?.signed_at) throw new Error("Signed documents can't be deleted — void them instead.");
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/documents");
  redirect("/documents");
}
