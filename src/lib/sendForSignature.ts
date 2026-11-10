import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { docTypeClientLabel } from "@/lib/documentBlocks";
import { loadEventBundle } from "@/lib/documentRender";
import { processOutbox } from "@/lib/mailgun";
import { agreementEmailHtml, appUrl } from "@/lib/signing";

/** The exact agreement email a later approval must still match. The sign link
    is minted with the document, so this body is the one sendDocumentForSignature
    will queue. */
export async function previewDocumentSend(supabase: SupabaseClient, id: string) {
  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, doc_type, status, signed_at, updated_at, blocks, event_id, access_token, event:events(id, name, client:clients(first_name, last_name, email))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company_settings").select("company_name").eq("id", true).maybeSingle(),
  ]);
  if (!doc) throw new Error("Document not found.");
  const ev = doc.event as unknown as {
    name?: string;
    client?: { first_name?: string; email?: string | null } | null;
  } | null;
  const bundle = doc.event_id ? await loadEventBundle(supabase, doc.event_id) : null;
  const firstName = ev?.client?.first_name ?? "there";
  const docLabel = docTypeClientLabel(doc.doc_type);
  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const link = doc.access_token ? `${appUrl()}/sign/${doc.access_token}` : "";
  const body = bundle
    ? agreementEmailHtml({
        bundle,
        docLabel,
        firstName,
        buttonUrl: link,
        companyName,
      })
    : null;
  return {
    document_id: doc.id,
    title: doc.title,
    status: doc.status,
    signed: Boolean(doc.signed_at),
    document_updated_at: doc.updated_at ?? null,
    blocks_sha256: createHash("sha256").update(JSON.stringify(doc.blocks ?? null), "utf8").digest("hex"),
    event: ev?.name ?? null,
    to: ev?.client?.email ?? null,
    subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
    body,
    body_sha256: createHash("sha256").update(body ?? "", "utf8").digest("hex"),
  };
}

/** The Documents "Send for signature" button. Builds the quote email from the
    event bundle (package, add-ons, investment, payment plan) and sends it
    through the outbox. Do not insert a raw email_log row instead — the quote
    block is rendered here, not by the database merge-tag function. */
export async function sendDocumentForSignature(
  supabase: SupabaseClient,
  id: string,
): Promise<{ eventId: string | null; to: string }> {
  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, event:events(id, name, client:clients(first_name, last_name, email))")
      .eq("id", id)
      .single(),
    supabase.from("company_settings").select("company_name, from_name, from_email, reply_to").eq("id", true).maybeSingle(),
  ]);
  if (!doc) throw new Error("Document not found");
  if (doc.signed_at) throw new Error("Already signed.");
  if (doc.status === "void") throw new Error("Document is void.");

  const ev = doc.event as unknown as {
    id: string;
    name: string;
    client: { first_name: string; last_name: string; email: string | null } | null;
  } | null;
  const clientEmail = ev?.client?.email;
  if (!clientEmail) throw new Error("The event's primary client has no email address on file.");

  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const firstName = ev?.client?.first_name ?? "there";
  const link = `${appUrl()}/sign/${doc.access_token}`;
  const docLabel = docTypeClientLabel(doc.doc_type);

  const bundle = await loadEventBundle(supabase, doc.event_id);
  if (!bundle) throw new Error("Could not load event data for the email.");

  const bodyHtml = agreementEmailHtml({
    bundle,
    docLabel,
    firstName,
    buttonUrl: link,
    companyName,
  });
  const { data: queued, error } = await supabase.from("email_log").insert({
    event_id: ev?.id ?? null,
    to_address: clientEmail,
    from_name: cs?.from_name ?? companyName,
    from_address: cs?.from_email ?? null,
    reply_to: cs?.reply_to ?? null,
    subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
    body_html: bodyHtml,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await processOutbox(supabase, { onlyIds: [queued.id as string] });

  await supabase
    .from("documents")
    .update({ status: "sent", visible_to_client: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  return { eventId: ev?.id ?? null, to: clientEmail };
}
