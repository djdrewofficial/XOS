import type { SupabaseClient } from "@supabase/supabase-js";
import { docTypeClientLabel } from "@/lib/documentBlocks";
import { loadEventBundle } from "@/lib/documentRender";
import { processOutbox } from "@/lib/mailgun";
import { agreementEmailHtml, appUrl } from "@/lib/signing";

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

  const { error } = await supabase.from("email_log").insert({
    event_id: ev?.id ?? null,
    to_address: clientEmail,
    from_name: cs?.from_name ?? companyName,
    from_address: cs?.from_email ?? null,
    reply_to: cs?.reply_to ?? null,
    subject: `Your ${docLabel} is ready, ${firstName}! 🎉`,
    body_html: agreementEmailHtml({
      bundle,
      docLabel,
      firstName,
      buttonUrl: link,
      companyName,
    }),
  });
  if (error) throw new Error(error.message);
  await processOutbox(supabase);

  await supabase
    .from("documents")
    .update({ status: "sent", visible_to_client: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  return { eventId: ev?.id ?? null, to: clientEmail };
}
