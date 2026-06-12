"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sanitizeBlocks, type DocBlock } from "@/lib/documentBlocks";
import { renderBlocks } from "@/lib/documentRender";

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
  return sanitizeBlocks(manifest).map((b) =>
    b.type === "text" ? { ...b, html: (formData.get(`block_html_${b.id}`) ?? "").toString() } : b
  );
}

/* ---------------- templates ---------------- */

export async function createTemplate(formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_templates")
    .update({
      name: clean(formData.get("name")) ?? "Untitled",
      doc_type: clean(formData.get("doc_type")) ?? "contract",
      blocks: blocksFromForm(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/templates/${id}`);
  revalidatePath("/documents");
}

export async function duplicateTemplate(id: string) {
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
  const templateId = clean(formData.get("template_id"));
  const eventId = clean(formData.get("event_id"));
  if (!templateId || !eventId) return;

  const supabase = await createClient();
  const [{ data: template }, { data: event }] = await Promise.all([
    supabase.from("document_templates").select("*").eq("id", templateId).single(),
    supabase.from("events").select("id, name, client:clients(first_name, last_name)").eq("id", eventId).single(),
  ]);
  if (!template || !event) throw new Error("Template or event not found");

  const rendered = await renderBlocks(supabase, eventId, sanitizeBlocks(template.blocks));
  if (!rendered) throw new Error("Could not render document for this event");

  const client = event.client as unknown as { first_name: string; last_name: string } | null;
  const title = `${template.name} — ${client ? `${client.first_name} ${client.last_name}`.trim() : event.name || "Event"}`;

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      template_id: templateId,
      event_id: eventId,
      title,
      doc_type: template.doc_type,
      blocks: rendered,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/documents");
  redirect(`/documents/${doc.id}`);
}

export async function updateDocumentBlocks(id: string, formData: FormData) {
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

export async function setDocumentVisibility(id: string, eventId: string, visible: boolean) {
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
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("signed_at").eq("id", id).single();
  if (doc?.signed_at) throw new Error("Signed documents can't be deleted — void them instead.");
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/documents");
  redirect("/documents");
}
