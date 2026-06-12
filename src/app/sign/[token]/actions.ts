"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { sanitizeBlocks, docTypeClientLabel, type DocBlock } from "@/lib/documentBlocks";
import { appUrl, signingEmailHtml } from "@/lib/signing";

export type SignResult = {
  ok: boolean;
  error?: string;
  afterSignUrl?: string | null;
};

/* The legally-relevant act: validates intent + consent, freezes a content hash,
   records the full audit trail, locks the document, notifies the office, and
   emails the client their signed copy. Runs with the service role — the public
   page has no session; the unguessable token is the authorization. */
export async function signDocument(
  token: string,
  _prev: SignResult | null,
  formData: FormData
): Promise<SignResult> {
  const signerName = (formData.get("signer_name") ?? "").toString().trim();
  const consent = formData.get("consent") === "on";
  if (signerName.length < 3) return { ok: false, error: "Please type your full legal name." };
  if (!consent) return { ok: false, error: "Please check the agreement box to continue." };

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("*, event:events(id, name, event_date, client:clients(first_name, last_name, email))")
    .eq("access_token", token)
    .maybeSingle();

  if (!doc) return { ok: false, error: "This document link is no longer valid." };
  if (doc.signed_at) return { ok: false, error: "This document has already been signed." };
  if (doc.status === "void") return { ok: false, error: "This document is no longer active." };
  if (doc.visible_to_client === false) return { ok: false, error: "This document is not currently available." };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const userAgent = hdrs.get("user-agent") ?? "unknown";
  const signedAt = new Date();

  // tamper evidence: hash the exact content being signed
  const blocks = sanitizeBlocks(doc.blocks);
  const docHash = createHash("sha256").update(JSON.stringify(blocks)).digest("hex");

  // fill the signature block with the executed signature
  const signedBlocks: DocBlock[] = blocks.map((b) =>
    b.type === "signature"
      ? {
          ...b,
          html: `<div class="xdoc-sign xdoc-signed"><div class="xdoc-sign-script">${signerName
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</div><div class="xdoc-sign-name">${signerName
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</div><div class="xdoc-sign-meta">Electronically signed · ${signedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · IP ${ip}</div></div>`,
        }
      : b
  );

  const { error } = await supabase
    .from("documents")
    .update({
      blocks: signedBlocks,
      status: "signed",
      signer_name: signerName,
      signed_at: signedAt.toISOString(),
      signer_ip: ip,
      signer_user_agent: userAgent,
      doc_hash: docHash,
      updated_at: signedAt.toISOString(),
    })
    .eq("id", doc.id)
    .is("signed_at", null); // double-submit guard
  if (error) return { ok: false, error: "Something went wrong saving the signature — please try again." };

  const ev = doc.event as unknown as {
    id: string;
    name: string;
    client: { first_name: string; last_name: string; email: string | null } | null;
  } | null;

  // after-sign automation: run the template's booking helper (status → Booked,
  // confirmation email, retainer request — whatever the helper is configured to
  // do). Emails it queues drain with the single outbox pass below.
  let afterSignUrl: string | null = null;
  if (doc.template_id) {
    const { data: t } = await supabase
      .from("document_templates")
      .select("after_sign_url, after_sign_helper_id")
      .eq("id", doc.template_id)
      .maybeSingle();
    afterSignUrl = t?.after_sign_url ?? null;
    if (t?.after_sign_helper_id && ev?.id) {
      const { error: helperError } = await supabase.rpc("run_booking_helper", {
        p_helper_id: t.after_sign_helper_id,
        p_event_id: ev.id,
      });
      if (helperError) {
        // the signature itself succeeded — surface the automation failure instead of failing the client
        await supabase.rpc("create_notification", {
          p_type: "document_signed",
          p_title: `After-sign automation failed: ${doc.title}`,
          p_body: helperError.message,
          p_href: `/events/${ev.id}`,
        });
      }
    }
  }

  // office notification (respects the General settings allowlist)
  await supabase.rpc("create_notification", {
    p_type: "document_signed",
    p_title: `Signed: ${doc.title}`,
    p_body: `${signerName} · ${signedAt.toLocaleString()}`,
    p_href: `/documents/${doc.id}`,
  });

  // email the client their signed copy
  const { data: cs } = await supabase
    .from("company_settings")
    .select("company_name, from_name, from_email, reply_to")
    .eq("id", true)
    .maybeSingle();
  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const clientEmail = ev?.client?.email ?? null;
  if (clientEmail) {
    await supabase.from("email_log").insert({
      event_id: ev?.id ?? null,
      to_address: clientEmail,
      from_name: cs?.from_name ?? companyName,
      from_address: cs?.from_email ?? null,
      reply_to: cs?.reply_to ?? null,
      subject: `Signed copy: ${doc.title}`,
      body_html: signingEmailHtml({
        heading: "You're all set! 🎉",
        bodyHtml: `<p>Thank you, ${signerName.split(" ")[0]}! Your <strong>${docTypeClientLabel(doc.doc_type)}</strong> was signed on ${signedAt.toLocaleDateString()}.</p><p>Keep this email — the button below opens your signed copy any time, and you can print or save it as a PDF.</p>`,
        buttonLabel: `View My Signed ${docTypeClientLabel(doc.doc_type)}`,
        buttonUrl: `${appUrl()}/sign/${token}`,
        companyName,
      }),
    });
  }

  // one drain sends the signed copy plus anything the after-sign helper queued
  await processOutbox(supabase);

  revalidatePath(`/documents/${doc.id}`);
  if (ev?.id) revalidatePath(`/events/${ev.id}`);
  revalidatePath("/documents");

  return { ok: true, afterSignUrl };
}
