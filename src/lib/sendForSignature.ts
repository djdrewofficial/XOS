import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { docTypeClientLabel } from "@/lib/documentBlocks";
import { loadEventBundle } from "@/lib/documentRender";
import {
  parseRecipientConfig,
  resolveHelperRecipients,
  type HelperRecipientConfig,
} from "@/lib/helperRecipients";
import { loadEventContacts } from "@/lib/loadEventContacts";
import { processOutbox } from "@/lib/mailgun";
import { agreementEmailHtml, appUrl } from "@/lib/signing";

export type DocumentSendRecipientInput = {
  /** Exact client ids. When set, replaces role/mode resolution. */
  clientIds?: string[] | null;
  /** Role/mode config (same shape as helper steps). Default = primary client. */
  recipients?: HelperRecipientConfig | null;
};

async function resolveDocumentEmailRecipients(
  supabase: SupabaseClient,
  eventId: string,
  input?: DocumentSendRecipientInput | null,
) {
  const contacts = await loadEventContacts(supabase, eventId);
  const cfg = parseRecipientConfig(input?.recipients ?? { mode: "default" });
  return resolveHelperRecipients({
    contacts,
    config: cfg,
    overrideClientIds: input?.clientIds ?? null,
    channel: "email",
  });
}

/** The exact agreement email a later approval must still match. The sign link
    is minted with the document, so this body is the one sendDocumentForSignature
    will queue. */
export async function previewDocumentSend(
  supabase: SupabaseClient,
  id: string,
  recipientInput?: DocumentSendRecipientInput | null,
) {
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

  let to: string | null = ev?.client?.email ?? null;
  let firstName = ev?.client?.first_name ?? "there";
  let recipientSummary: { clientId: string; name: string; email: string }[] = [];
  const warnings: string[] = [];

  if (doc.event_id) {
    const resolved = await resolveDocumentEmailRecipients(supabase, doc.event_id, recipientInput);
    warnings.push(...resolved.warnings);
    recipientSummary = resolved.selected.map((r) => ({
      clientId: r.clientId,
      name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Contact",
      email: (r.email ?? "").trim(),
    }));
    if (resolved.selected[0]) {
      to = resolved.selected.map((r) => r.email).filter(Boolean).join(", ") || null;
      firstName = resolved.selected[0].firstName ?? firstName;
    } else if (recipientInput?.clientIds || recipientInput?.recipients) {
      to = null;
    }
  }

  const bundle = doc.event_id ? await loadEventBundle(supabase, doc.event_id) : null;
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
    to,
    recipients: recipientSummary,
    warnings,
    /**
     * Signer of record stays whoever completes /sign/[token]. Recipient selection
     * only changes who receives the email with the link — not who is forced to sign.
     */
    signer_note:
      "Recipients get the sign link by email. The signer of record is whoever opens the link and signs. Contract holder is unchanged unless you also change membership on the event.",
    subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
    body,
    body_sha256: createHash("sha256").update(body ?? "", "utf8").digest("hex"),
  };
}

/** The Documents "Send for signature" button. Builds the quote email from the
    event bundle (package, add-ons, investment, payment plan) and sends it
    through the outbox. Do not insert a raw email_log row instead — the quote
    block is rendered here, not by the database merge-tag function.

    Optional recipientInput lets staff (or MCP) send the agreement to someone
    other than the primary client (e.g. the planner). Merge tags and the sign
    link still go through this app path. The signer of record remains whoever
    completes the public sign flow — recipient ≠ signer. */
export async function sendDocumentForSignature(
  supabase: SupabaseClient,
  id: string,
  recipientInput?: DocumentSendRecipientInput | null,
): Promise<{ eventId: string | null; to: string; recipients: { clientId: string; email: string }[]; warnings: string[] }> {
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

  if (!doc.event_id || !ev?.id) throw new Error("Document is not attached to an event.");

  const resolved = await resolveDocumentEmailRecipients(supabase, doc.event_id, recipientInput);
  if (resolved.selected.length === 0) {
    const detail = resolved.warnings[0] ?? "No recipient email address on file.";
    throw new Error(detail);
  }

  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const link = `${appUrl()}/sign/${doc.access_token}`;
  const docLabel = docTypeClientLabel(doc.doc_type);

  const bundle = await loadEventBundle(supabase, doc.event_id);
  if (!bundle) throw new Error("Could not load event data for the email.");

  const queuedIds: string[] = [];
  const sentTo: { clientId: string; email: string }[] = [];

  // Greeting uses the recipient's first name (who is reading the inbox), not
  // the contract holder. The agreement body itself still names the holder via
  // merge tags / document render. Mixing "Hi Jordyn" with a Jamie-named
  // agreement is intentional when the planner receives the sign link.
  for (const recip of resolved.selected) {
    const firstName = recip.firstName ?? "there";
    const bodyHtml = agreementEmailHtml({
      bundle,
      docLabel,
      firstName,
      buttonUrl: link,
      companyName,
    });
    const { data: queued, error } = await supabase.from("email_log").insert({
      event_id: ev.id,
      client_id: recip.clientId,
      to_address: recip.email,
      from_name: cs?.from_name ?? companyName,
      from_address: cs?.from_email ?? null,
      reply_to: cs?.reply_to ?? null,
      subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
      body_html: bodyHtml,
    }).select("id").single();
    if (error) throw new Error(error.message);
    queuedIds.push(queued.id as string);
    sentTo.push({ clientId: recip.clientId, email: recip.email as string });
  }

  await processOutbox(supabase, { onlyIds: queuedIds });

  await supabase
    .from("documents")
    .update({ status: "sent", visible_to_client: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  return {
    eventId: ev.id,
    to: sentTo.map((r) => r.email).join(", "),
    recipients: sentTo,
    warnings: resolved.warnings,
  };
}
