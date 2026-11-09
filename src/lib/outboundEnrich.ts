import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { docTypeClientLabel } from "./documentBlocks";
import { finalizeOutbound, type OutboundFile, type PlannedAttachment } from "./outboundPlan";

export type EnrichMessage = {
  id: string;
  event_id: string | null;
  template_id: string | null;
  body_html: string;
  attached_document_id: string | null;
};

export type EnrichDeps = {
  fillJoinLinks: (eventId: string | null, html: string) => Promise<string>;
  loadEventBundle: (supabase: SupabaseClient, eventId: string) => Promise<unknown>;
  quoteSummaryHtml: (bundle: never) => string;
  paymentPlanHtml: (bundle: never) => string;
  signButtonHtml: (url: string, label: string) => string;
  appUrl: () => string;
  createAdminClient: () => SupabaseClient;
  generateDocumentRow: (supabase: SupabaseClient, templateId: string, eventId: string, status: string) => Promise<{ id: string; access_token?: string; doc_type?: string } | null>;
  buildDocumentHtml: (supabase: SupabaseClient, documentId: string) => Promise<{ html: string; title: string } | null>;
  htmlToPdf: (html: string) => Promise<Buffer>;
};

export type EnrichedOutbound = {
  html: string;
  attachments: PlannedAttachment[];
  branded: boolean;
  isMarketing: boolean;
  documentHtmlSha256: string | null;
  fileSha256: string[];
  pdfDeferred: boolean;
};

function tagPresent(html: string, tag: string): boolean {
  return html.includes(`<${tag}>`) || html.includes(`&lt;${tag}&gt;`);
}

function replaceTag(html: string, tag: string, value: string): string {
  return html.split(`<${tag}>`).join(value).split(`&lt;${tag}&gt;`).join(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The bytes handed to the mail provider. A missing or different stamp does not send. */
export function decideDelivery(
  enriched: { html: string; attachments: PlannedAttachment[]; documentHtmlSha256?: string | null; fileSha256?: string[] },
  expected?: { documentHtmlSha256: string | null; fileSha256: string[] } | null,
): { deliver: boolean; html: string; attachments: PlannedAttachment[] } {
  if (!expected) return { deliver: true, html: enriched.html, attachments: enriched.attachments };
  const files = [...(enriched.fileSha256 ?? [])].sort();
  const wanted = [...expected.fileSha256].sort();
  const sameFiles = files.length === wanted.length && files.every((hash, index) => hash === wanted[index]);
  const sameDocument = (enriched.documentHtmlSha256 ?? null) === (expected.documentHtmlSha256 ?? null);
  if (!sameFiles || !sameDocument) return { deliver: false, html: enriched.html, attachments: [] };
  return { deliver: true, html: enriched.html, attachments: enriched.attachments };
}

/**
 * Shared send-time enrichment. Agent-rendered HTML does not skip files.
 * commit false plans the files and the document HTML hash without inserting,
 * uploading, or rendering a Chrome PDF. The PDF bytes are produced once, on the
 * send, after decideDelivery accepts the source hash.
 */
export async function enrichOutbound(
  supabase: SupabaseClient,
  msg: EnrichMessage,
  deps: EnrichDeps,
  opts?: { commit?: boolean },
): Promise<EnrichedOutbound> {
  const commit = opts?.commit !== false;
  let html = await deps.fillJoinLinks(msg.event_id, msg.body_html ?? "");
  const files: OutboundFile[] = [];
  const eventFileSha256: string[] = [];
  let documentHtmlSha256: string | null = null;
  let pdfDeferred = false;

  let tmpl: { attach_template_id?: string | null; attach_mode?: string | null; branded_shell?: boolean; attach_file_label_ids?: string[] | null; is_marketing?: boolean } | null = null;
  if (msg.template_id) {
    const { data } = await supabase.from("email_templates").select("*").eq("id", msg.template_id).maybeSingle();
    tmpl = data;
  }
  const branded = tmpl?.branded_shell ?? true;
  const isMarketing = tmpl?.is_marketing === true;
  const agentRendered = html.includes('data-xos-rendered="agent"');

  const finish = (nextHtml: string): EnrichedOutbound => {
    const planned = finalizeOutbound(nextHtml, files);
    return { html: planned.html, attachments: planned.attachments, branded, isMarketing, documentHtmlSha256, fileSha256: eventFileSha256, pdfDeferred };
  };

  if (!msg.event_id) return finish(html);

  const { data: ev } = await supabase.from("events").select("pay_token, event_type_id").eq("id", msg.event_id).maybeSingle();
  const payToken = (ev?.pay_token as string | null) ?? null;
  const { data: js } = await supabase.from("journey_settings").select("proposal_flow_enabled, proposal_doc_template_id").eq("id", true).maybeSingle();
  const proposalFlow = js?.proposal_flow_enabled === true;
  let typeProposalTpl: string | null = null;
  if (ev?.event_type_id) {
    const { data: et } = await supabase.from("event_types").select("proposal_doc_template_id").eq("id", ev.event_type_id).maybeSingle();
    typeProposalTpl = (et?.proposal_doc_template_id as string | null) ?? null;
  }
  const proposalDocId = typeProposalTpl ?? (js?.proposal_doc_template_id as string | null) ?? null;

  if (tagPresent(html, "quote_summary") || tagPresent(html, "payment_plan")) {
    const bundle = await deps.loadEventBundle(supabase, msg.event_id);
    if (bundle) {
      html = replaceTag(html, "quote_summary", deps.quoteSummaryHtml(bundle as never));
      html = replaceTag(html, "payment_plan", deps.paymentPlanHtml(bundle as never));
    }
  }

  if (tagPresent(html, "payment_link") || tagPresent(html, "payment_button")) {
    const payUrl = payToken ? `${deps.appUrl()}/pay/${payToken}` : "";
    html = replaceTag(html, "payment_link", payUrl);
    html = replaceTag(html, "payment_button", payUrl ? deps.signButtonHtml(payUrl, "Pay Online") : "");
  }
  if (tagPresent(html, "review_sign_link") || tagPresent(html, "review_sign_button")) {
    const url = payToken ? `${deps.appUrl()}/proposal/${payToken}` : "";
    html = replaceTag(html, "review_sign_link", url);
    html = replaceTag(html, "review_sign_button", url ? deps.signButtonHtml(url, "Review & Sign") : "");
  }
  if (tagPresent(html, "journey_start_link") || tagPresent(html, "journey_start_button")) {
    const url = payToken ? `${deps.appUrl()}/proposal/${payToken}` : "";
    html = replaceTag(html, "journey_start_link", url);
    html = replaceTag(html, "journey_start_button", url ? deps.signButtonHtml(url, "Get Started") : "");
  }

  const configuredLabelIds = tmpl?.attach_file_label_ids ?? [];
  if (html.includes("document_") || configuredLabelIds.length > 0) {
    const admin = deps.createAdminClient();
    const { data: labels } = await admin.from("file_label_definitions").select("id, slug, name").eq("is_active", true);
    const ATTACH_BUDGET = 10 * 1024 * 1024;
    let attachedBytes = files.reduce((n, a) => n + a.data.length, 0);
    const seenPaths = new Set<string>();
    for (const lbl of labels ?? []) {
      const tag = `document_${lbl.slug}`;
      const inBody = tagPresent(html, tag);
      const inConfig = configuredLabelIds.includes(lbl.id);
      if (!inBody && !inConfig) continue;
      const { data: rows } = await admin.from("event_files").select("name, path, content_type, size_bytes").eq("event_id", msg.event_id).eq("label_id", lbl.id).order("created_at", { ascending: false });
      const links: string[] = [];
      for (const f of rows ?? []) {
        if (seenPaths.has(f.path)) continue;
        seenPaths.add(f.path);
        const size = Number(f.size_bytes ?? 0);
        let attached = false;
        if (size === 0 || attachedBytes + size <= ATTACH_BUDGET) {
          const { data: blob } = await admin.storage.from("event-files").download(f.path);
          if (blob) {
            const buf = Buffer.from(await blob.arrayBuffer());
            if (attachedBytes + buf.length <= ATTACH_BUDGET) {
              files.push({ filename: f.name, contentType: f.content_type || "application/octet-stream", data: buf });
              eventFileSha256.push(sha256(buf));
              attachedBytes += buf.length;
              attached = true;
            }
          }
        }
        if (!attached) {
          const { data: signed } = await admin.storage.from("event-files").createSignedUrl(f.path, 60 * 60 * 24 * 7);
          if (signed?.signedUrl) links.push(`<a href="${signed.signedUrl}">${f.name}</a>`);
        }
      }
      const linkLine = links.length ? `<p style="margin:0 0 12px;">${lbl.name}: ${links.join(" · ")}</p>` : "";
      if (inBody) html = replaceTag(html, tag, linkLine);
      else if (linkLine) html += linkLine;
    }
  }

  if (!tmpl?.attach_template_id) return finish(replaceTag(html, "document_sign_link", ""));

  let attachTemplateId = tmpl.attach_template_id as string;
  if (proposalDocId && attachTemplateId !== proposalDocId) {
    const { data: typeTpls } = await supabase.from("event_types").select("proposal_doc_template_id").not("proposal_doc_template_id", "is", null);
    const proposalContractIds = new Set<string>([js?.proposal_doc_template_id, ...(typeTpls ?? []).map((t: { proposal_doc_template_id: string }) => t.proposal_doc_template_id)].filter(Boolean) as string[]);
    if (proposalContractIds.has(attachTemplateId)) attachTemplateId = proposalDocId;
  }

  if ((tmpl.attach_mode ?? "esign_link") === "esign_link") {
    if (proposalFlow && payToken && (!proposalDocId || attachTemplateId === proposalDocId)) {
      const url = `${deps.appUrl()}/proposal/${payToken}`;
      if (tagPresent(html, "document_sign_link")) html = replaceTag(html, "document_sign_link", url);
      else if (!agentRendered) html += deps.signButtonHtml(url, `Review & Sign ${docTypeClientLabel("contract")}`);
      return finish(replaceTag(html, "document_sign_link", ""));
    }
    const { data: existing } = await supabase.from("documents").select("id, access_token, doc_type").eq("event_id", msg.event_id).eq("template_id", attachTemplateId).is("signed_at", null).neq("status", "void").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const doc = existing ?? (commit ? await deps.generateDocumentRow(supabase, attachTemplateId, msg.event_id, "sent") : null);
    if (doc) {
      const link = `${deps.appUrl()}/sign/${doc.access_token}`;
      if (tagPresent(html, "document_sign_link")) html = replaceTag(html, "document_sign_link", link);
      else if (!agentRendered) html += deps.signButtonHtml(link, `Review & Sign ${docTypeClientLabel(doc.doc_type)}`);
      if (commit) {
        await supabase.from("documents").update({ status: "sent" }).eq("id", doc.id).is("signed_at", null);
        await supabase.from("email_log").update({ attached_document_id: doc.id }).eq("id", msg.id);
      }
    }
  } else {
    const { data: docs } = await supabase.from("documents").select("id, title, signed_at").eq("event_id", msg.event_id).eq("template_id", attachTemplateId).neq("status", "void").order("created_at", { ascending: false });
    const pick = (docs ?? []).find((d: { signed_at?: string | null }) => d.signed_at) ?? (docs ?? [])[0] ?? null;
    const doc = pick ?? (commit ? await deps.generateDocumentRow(supabase, attachTemplateId, msg.event_id, "final") : null);
    if (!pick && !commit) pdfDeferred = true;
    if (doc) {
      const built = await deps.buildDocumentHtml(supabase, doc.id);
      if (built) {
        documentHtmlSha256 = sha256(built.html);
        if (commit) {
          const pdf = await deps.htmlToPdf(built.html);
          const filename = `${built.title.replace(/[^\w\- &']+/g, "").trim() || "Document"}.pdf`;
          files.push({ filename, contentType: "application/pdf", data: pdf });
          const path = `${msg.event_id}/${doc.id}-${Date.now()}.pdf`;
          const { error: upError } = await supabase.storage.from("event-files").upload(path, pdf, { contentType: "application/pdf", upsert: true });
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
          await supabase.from("email_log").update({ attached_document_id: doc.id, attached_file_name: filename }).eq("id", msg.id);
        }
      }
    }
  }

  return finish(replaceTag(html, "document_sign_link", ""));
}
