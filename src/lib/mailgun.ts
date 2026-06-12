import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadEventBundle, generateDocumentRow } from "@/lib/documentRender";
import { docTypeClientLabel } from "@/lib/documentBlocks";
import { appUrl, quoteSummaryHtml, paymentPlanHtml, signButtonHtml } from "@/lib/signing";
import { buildDocumentHtml } from "@/lib/documentHtml";
import { htmlToPdf } from "@/lib/pdf";

/* ============ Mailgun config ============
   Set in .env.local:
     MAILGUN_API_KEY     — Sending → Domain settings → API keys
     MAILGUN_DOMAIN      — e.g. xpressdjs.com (or mg.xpressdjs.com)
     MAILGUN_REGION      — "us" (default) or "eu"
     MAIL_FROM           — fallback From when a message has no stored sender
     MAILGUN_SIGNING_KEY — webhook signing key (for delivery tracking)
*/
function mailgunConfig() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const region = (process.env.MAILGUN_REGION ?? "us").toLowerCase();
  const base = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  return { apiKey, domain, base };
}

export function isMailgunConfigured(): boolean {
  const { apiKey, domain } = mailgunConfig();
  return !!(apiKey && domain);
}

function fmtSender(name: string | null, email: string): string {
  return name ? `${name} <${email}>` : email;
}

export type EmailAttachment = { filename: string; data: Buffer; contentType: string };

/** Low-level send. Returns Mailgun's message id on success. */
async function mailgunSend(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
  tags?: string[];
  attachments?: EmailAttachment[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { apiKey, domain, base } = mailgunConfig();
  if (!apiKey || !domain) return { ok: false, error: "Mailgun not configured" };

  const form = new FormData();
  form.append("from", opts.from);
  form.append("to", opts.to);
  form.append("subject", opts.subject);
  form.append("html", opts.html || "<p>(empty)</p>");
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);
  for (const tag of opts.tags ?? []) form.append("o:tag", tag);
  for (const att of opts.attachments ?? []) {
    form.append("attachment", new Blob([new Uint8Array(att.data)], { type: att.contentType }), att.filename);
  }

  try {
    const res = await fetch(`${base}/v3/${domain}/messages`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64") },
      body: form,
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      // Mailgun returns the id wrapped in <>; strip for clean correlation with webhooks.
      const id = (data.id ?? "").replace(/^<|>$/g, "");
      return { ok: true, id };
    }
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/* ============ Send-time enrichment ============
   Replaces TS-side merge tags (<quote_summary>, <payment_plan>,
   <document_sign_link>) and handles the email template's attached document:
   e-sign link merged into the body, or a branded PDF rendered, attached, and
   saved to the event's files. Runs identically for booking helpers, scheduled
   templates, and manual sends. */

function tagPresent(html: string, tag: string): boolean {
  return html.includes(`<${tag}>`) || html.includes(`&lt;${tag}&gt;`);
}

function replaceTag(html: string, tag: string, value: string): string {
  return html.split(`<${tag}>`).join(value).split(`&lt;${tag}&gt;`).join(value);
}

async function enrichMessage(
  supabase: SupabaseClient,
  msg: {
    id: string;
    event_id: string | null;
    template_id: string | null;
    body_html: string;
    attached_document_id: string | null;
  }
): Promise<{ html: string; attachments: EmailAttachment[] }> {
  let html = msg.body_html ?? "";
  const attachments: EmailAttachment[] = [];
  if (!msg.event_id) return { html, attachments };

  // quote-style merge tags
  if (tagPresent(html, "quote_summary") || tagPresent(html, "payment_plan")) {
    const bundle = await loadEventBundle(supabase, msg.event_id);
    if (bundle) {
      html = replaceTag(html, "quote_summary", quoteSummaryHtml(bundle));
      html = replaceTag(html, "payment_plan", paymentPlanHtml(bundle));
    }
  }

  // document attached to the email template?
  if (!msg.template_id) return { html, attachments };
  const { data: tmpl } = await supabase
    .from("email_templates")
    .select("attach_template_id, attach_mode")
    .eq("id", msg.template_id)
    .maybeSingle();
  if (!tmpl?.attach_template_id) {
    // no attachment configured — still clean up a dangling sign-link tag
    return { html: replaceTag(html, "document_sign_link", ""), attachments };
  }

  if (tmpl.attach_mode === "esign_link") {
    // reuse the latest unsigned document for this event+template, else generate fresh
    const { data: existing } = await supabase
      .from("documents")
      .select("id, access_token, doc_type")
      .eq("event_id", msg.event_id)
      .eq("template_id", tmpl.attach_template_id)
      .is("signed_at", null)
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const doc =
      existing ?? (await generateDocumentRow(supabase, tmpl.attach_template_id, msg.event_id, "sent"));
    if (doc) {
      const link = `${appUrl()}/sign/${doc.access_token}`;
      if (tagPresent(html, "document_sign_link")) {
        html = replaceTag(html, "document_sign_link", link);
      } else {
        html += signButtonHtml(link, `Review & Sign ${docTypeClientLabel(doc.doc_type)}`);
      }
      await supabase.from("documents").update({ status: "sent" }).eq("id", doc.id).is("signed_at", null);
      await supabase.from("email_log").update({ attached_document_id: doc.id }).eq("id", msg.id);
    }
  } else {
    // pdf attachment: prefer the latest SIGNED document, else latest, else generate
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, signed_at")
      .eq("event_id", msg.event_id)
      .eq("template_id", tmpl.attach_template_id)
      .neq("status", "void")
      .order("created_at", { ascending: false });
    const pick = (docs ?? []).find((d) => d.signed_at) ?? (docs ?? [])[0] ?? null;
    const doc =
      pick ?? (await generateDocumentRow(supabase, tmpl.attach_template_id, msg.event_id, "final"));
    if (doc) {
      const built = await buildDocumentHtml(supabase, doc.id);
      if (built) {
        const pdf = await htmlToPdf(built.html);
        const filename = `${built.title.replace(/[^\w\- &']+/g, "").trim() || "Document"}.pdf`;
        attachments.push({ filename, data: pdf, contentType: "application/pdf" });

        // save a copy to the event's files
        const path = `${msg.event_id}/${doc.id}-${Date.now()}.pdf`;
        const { error: upError } = await supabase.storage
          .from("event-files")
          .upload(path, pdf, { contentType: "application/pdf", upsert: true });
        if (!upError) {
          await supabase.from("event_files").insert({
            event_id: msg.event_id,
            document_id: doc.id,
            name: filename,
            path,
            content_type: "application/pdf",
            size_bytes: pdf.length,
          });
        }
        await supabase
          .from("email_log")
          .update({ attached_document_id: doc.id, attached_file_name: filename })
          .eq("id", msg.id);
      }
    }
  }

  return { html: replaceTag(html, "document_sign_link", ""), attachments };
}

/** Drains queued rows from the outbox through Mailgun, using each row's stored sender identity.
    Pass a service-role client when running without a user session (cron route). */
export async function processOutbox(
  client?: SupabaseClient
): Promise<{ sent: number; failed: number; skipped: string | null }> {
  const { domain } = mailgunConfig();
  if (!isMailgunConfigured()) {
    return { sent: 0, failed: 0, skipped: "Mailgun not configured (set MAILGUN_API_KEY and MAILGUN_DOMAIN in .env.local)" };
  }

  const fallbackFrom = process.env.MAIL_FROM ?? `Xpress Entertainment <events@${domain}>`;
  const supabase = client ?? (await createClient());
  const { data: queued } = await supabase
    .from("email_log")
    .select("*")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);

  let sent = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    const from = msg.from_address ? fmtSender(msg.from_name, msg.from_address) : fallbackFrom;

    // send-time enrichment: quote tags + attached documents (e-sign link / PDF)
    let html = msg.body_html;
    let attachments: EmailAttachment[] = [];
    try {
      const enriched = await enrichMessage(supabase, msg);
      html = enriched.html;
      attachments = enriched.attachments;
    } catch (err) {
      await supabase
        .from("email_log")
        .update({ status: "failed", error: `attachment: ${String(err).slice(0, 280)}` })
        .eq("id", msg.id);
      failed++;
      continue;
    }

    const result = await mailgunSend({
      from,
      to: msg.to_address,
      subject: msg.subject,
      html,
      replyTo: msg.reply_to,
      tags: ["xos", msg.event_id ? "event" : "manual"],
      attachments,
    });

    if (result.ok) {
      await supabase
        .from("email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.id || null,
          error: null,
        })
        .eq("id", msg.id);
      sent++;
    } else {
      await supabase.from("email_log").update({ status: "failed", error: result.error }).eq("id", msg.id);
      failed++;
    }
  }

  return { sent, failed, skipped: null };
}

/** Sends a one-off test email and records it in the outbox/log. */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const { domain } = mailgunConfig();
  if (!isMailgunConfigured()) return { ok: false, error: "Mailgun not configured" };

  const supabase = await createClient();
  const { data: cs } = await supabase
    .from("company_settings")
    .select("from_name, from_email, reply_to")
    .eq("id", true)
    .maybeSingle();

  const fromName = cs?.from_name ?? "Xpress Entertainment";
  const fromEmail = cs?.from_email ?? `events@${domain}`;
  const subject = "XOS test email";
  const html = `<p>This is a test email from XOS, sent through Mailgun (<strong>${domain}</strong>).</p>
    <p>If you're reading this, sending is configured correctly.</p>`;

  const result = await mailgunSend({
    from: fmtSender(fromName, fromEmail),
    to,
    subject,
    html,
    replyTo: cs?.reply_to ?? fromEmail,
    tags: ["xos", "test"],
  });

  await supabase.from("email_log").insert({
    to_address: to,
    from_name: fromName,
    from_address: fromEmail,
    reply_to: cs?.reply_to ?? fromEmail,
    subject,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    sent_at: result.ok ? new Date().toISOString() : null,
    provider_message_id: result.ok ? result.id || null : null,
    error: result.ok ? null : result.error,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
