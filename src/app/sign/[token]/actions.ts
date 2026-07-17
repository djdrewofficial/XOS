"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { sanitizeBlocks, docTypeClientLabel, type DocBlock } from "@/lib/documentBlocks";
import { appUrl, signingEmailHtml } from "@/lib/signing";
import { autoNameEvent } from "@/lib/eventName";
import { runAutomations } from "@/lib/automations";
import { loadEventJourney } from "@/lib/eventJourney";
import { sendAccountInvite } from "@/lib/accounts";

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
  const photoOptOut = formData.get("photo_optout") === "on";
  if (signerName.length < 3) return { ok: false, error: "Please type your full legal name." };
  if (!consent) return { ok: false, error: "Please check the agreement box to continue." };

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("*, event:events(id, name, event_date, journey_type_id, client:clients(id, first_name, last_name, email))")
    .eq("access_token", token)
    .maybeSingle();

  if (!doc) return { ok: false, error: "This document link is no longer valid." };
  if (doc.signed_at) return { ok: false, error: "This document has already been signed." };
  if (doc.status === "void") return { ok: false, error: "This document is no longer active." };
  if (doc.visible_to_client === false) return { ok: false, error: "This document is not currently available." };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // x-forwarded-for is client-controllable; escape before it goes into stored HTML.
  const ipSafe = ip.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
            .replace(/</g, "&lt;")}</div><div class="xdoc-sign-meta">Electronically signed · ${signedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · IP ${ipSafe}</div></div>`,
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
      // record the media-release choice only on docs that offer the opt-out
      photo_release_declined: doc.photo_release ? photoOptOut : null,
      updated_at: signedAt.toISOString(),
    })
    .eq("id", doc.id)
    .is("signed_at", null); // double-submit guard
  if (error) return { ok: false, error: "Something went wrong saving the signature — please try again." };

  const ev = doc.event as unknown as {
    id: string;
    name: string;
    journey_type_id: string | null;
    client: { id: string; first_name: string; last_name: string; email: string | null } | null;
  } | null;

  // which journey is this event on? drives the after-sign destination + whether
  // we send the client their app login.
  const journey = await loadEventJourney(supabase, ev?.journey_type_id);

  // auto-name unnamed events now that the couple's info is confirmed
  if (ev?.id) await autoNameEvent(supabase, ev.id);

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
    // Default forward: payment page on a normal journey, or the final app/
    // onboarding page on a no-payment venue-partner journey. Relative on purpose
    // — the redirect is client-side same-origin.
    if (!afterSignUrl && ev?.id) {
      const { data: evp } = await supabase.from("events").select("pay_token").eq("id", ev.id).maybeSingle();
      if (evp?.pay_token) {
        afterSignUrl = journey.step_payment ? `/welcome/${evp.pay_token}` : `/vibo/${evp.pay_token}`;
      }
    }
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

  // fire any "document signed" automations (configured per event type) — separate
  // from the template's after_sign_helper above, which stays for back-compat
  if (ev?.id) await runAutomations(supabase, ev.id, "document_signed");

  // App-onboarding journeys: now that they've signed, email the client their
  // initial login (set-password, deep-links into the app) + app download links,
  // so they can onboard themselves. The final page also shows the download links.
  if (journey.step_app_onboarding && ev?.client?.email) {
    await sendAccountInvite({
      type: "client",
      email: ev.client.email,
      name: ev.client.first_name || null,
      clientId: ev.client.id,
    });
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

  // one drain sends the signed copy plus anything the after-sign helper queued.
  // never let a mail/SMS hiccup throw — the signature is done and the client must
  // still be forwarded to payment.
  try {
    await processOutbox(supabase);
    await processSmsOutbox(supabase);
  } catch {
    /* delivery is retried by the outbox cron */
  }

  revalidatePath(`/documents/${doc.id}`);
  if (ev?.id) revalidatePath(`/events/${ev.id}`);
  revalidatePath("/documents");

  return { ok: true, afterSignUrl };
}
