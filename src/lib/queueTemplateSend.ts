import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { isPhoneOptedOut } from "@/lib/smsOptOut";
import { loadEventBundle, generateDocumentRow } from "@/lib/documentRender";
import { emailShell, paymentPlanHtml, quoteSummaryHtml, signButtonHtml } from "@/lib/signing";
import { appUrl } from "@/lib/signing";
import { canonicalJson, sha256 as sha256Text } from "@/lib/mcp/crypto";
import { assertSmsBody, classifyAgentSms } from "@/lib/mcp/smsPolicy";
import { docTypeClientLabel } from "@/lib/documentBlocks";

type Sender = { name?: string; email?: string; reply_to?: string };

/** Version stamp plus the fully rendered email. Secret links are placeholders. */
export async function freezeTemplateEmail(
  admin: SupabaseClient,
  input: { eventId: string; templateId: string; to: "primary_client" | "custom"; address?: string | null },
) {
  const template = await loadTemplate(admin, input.templateId, false);
  const rendered = await previewTemplateEmail(admin, input);
  return {
    template_id: template.id,
    template_updated_at: template.updated_at ?? null,
    template_body_sha256: sha256(template.body_html ?? ""),
    subject_template_sha256: sha256(template.subject ?? ""),
    attach_template_id: template.attach_template_id,
    rendered_to: rendered.to,
    rendered_subject: rendered.subject,
    rendered_body_sha256: sha256(rendered.body ?? ""),
  };
}

export async function previewTemplateEmail(
  admin: SupabaseClient,
  input: { eventId: string; templateId: string; to: "primary_client" | "custom"; address?: string | null },
) {
  const template = await loadTemplate(admin, input.templateId, false);
  const to = await resolveTo(admin, input);
  const subject = await renderTags(admin, input.eventId, template.subject ?? "");
  let body = await renderTags(admin, input.eventId, template.body_html ?? "");
  const bundle = await loadEventBundle(admin, input.eventId);
  if (bundle) {
    body = replaceTag(body, "quote_summary", quoteSummaryHtml(bundle));
    body = replaceTag(body, "payment_plan", paymentPlanHtml(bundle));
  }
  body = replaceTag(body, "document_sign_link", "[signing link]");
  body = replaceTag(body, "payment_link", "[payment link]");
  body = replaceTag(body, "payment_button", "[payment link]");
  body = replaceTag(body, "review_sign_link", "[proposal link]");
  body = replaceTag(body, "review_sign_button", "[proposal link]");
  body = replaceTag(body, "journey_start_link", "[journey link]");
  body = replaceTag(body, "journey_start_button", "[journey link]");
  if (template.branded_shell !== false) {
    const { data: cs } = await admin.from("company_settings").select("company_name").eq("id", true).maybeSingle();
    body = emailShell(cs?.company_name ?? "Xpress Entertainment", `<div data-xos-rendered="agent" style="padding:28px 30px;">${body}</div>`);
  } else {
    body = `<div data-xos-rendered="agent">${body}</div>`;
  }
  return {
    template_id: template.id,
    template: template.name,
    template_updated_at: template.updated_at ?? null,
    to,
    subject,
    body,
    attaches_document: Boolean(template.attach_template_id),
    is_sms: template.is_sms === true,
    link_policy: "Signing, payment, and proposal links are placeholders here. Approval is bound to this exact render. The real link is substituted only after the render still matches, and it is not returned to the agent.",
  };
}

/** Queue one email the way a booking helper's send_email action does (database
    merge tags + template id), then run processOutbox so the TypeScript tags and
    the contract attachment are applied. bypass_comms_pause is true because this
    is an explicit manual send, same as a staff helper click. */
export async function sendTemplateEmail(
  admin: SupabaseClient,
  input: { eventId: string; templateId: string; to: "primary_client" | "custom"; address?: string | null; from?: string | null; expectedHash?: string | null },
) {
  const frozen = await freezeTemplateEmail(admin, input);
  if (input.expectedHash && sha256Text(canonicalJson(frozen)) !== input.expectedHash) {
    throw new Error("The rendered email changed. Nothing was sent.");
  }
  const template = await loadTemplate(admin, input.templateId, false);
  if (template.is_sms) throw new Error("That template is a text, not an email.");
  const rendered = await previewTemplateEmail(admin, input);
  const to = rendered.to;
  if (!to) throw new Error("No recipient email address.");
  const sender = await resolveSender(admin, input.eventId, input.from ?? "company");
  const subject = rendered.subject;
  const body = await substituteClientLinks(admin, rendered.body ?? "", template, input.eventId);
  const { data: event } = await admin.from("events").select("client_id").eq("id", input.eventId).maybeSingle();
  const { data: queued, error } = await admin.from("email_log").insert({
    event_id: input.eventId,
    client_id: event?.client_id ?? null,
    template_id: template.id,
    to_address: to,
    from_name: sender.name ?? null,
    from_address: sender.email ?? null,
    reply_to: sender.reply_to ?? null,
    subject,
    body_html: body,
    status: "queued",
    bypass_comms_pause: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const drained = await processOutbox(admin, { onlyIds: [queued.id as string] });
  return { to, subject, drained, body_matched_approval: true };
}

export async function previewSms(
  admin: SupabaseClient,
  input: { eventId: string; body?: string | null; templateId?: string | null; to: "primary_client" | "custom"; number?: string | null },
) {
  const to = await resolveSmsTo(admin, input);
  const body = assertSmsBody(await smsBody(admin, input));
  const template = input.templateId ? await loadTemplate(admin, input.templateId, true) : null;
  const classification = classifyAgentSms({ templateId: input.templateId ?? null, templateIsMarketing: template?.sms_marketing === true });
  return {
    to,
    body,
    classification,
    stop_checked: true,
    note: "Nothing has been sent. A person must approve this exact text. Freeform texts are marketing and still pass the consent gate. STOP is always honored.",
  };
}

export async function sendSms(
  admin: SupabaseClient,
  input: { eventId: string; body?: string | null; templateId?: string | null; to: "primary_client" | "custom"; number?: string | null },
) {
  const to = await resolveSmsTo(admin, input);
  if (!to) throw new Error("No mobile number to text.");
  if (await isPhoneOptedOut(admin, to)) throw new Error("This number is opted out (STOP). Nothing was sent.");
  const body = assertSmsBody(await smsBody(admin, input));
  const template = input.templateId ? await loadTemplate(admin, input.templateId, true) : null;
  const classification = classifyAgentSms({ templateId: input.templateId ?? null, templateIsMarketing: template?.sms_marketing === true });
  const { data: event } = await admin.from("events").select("client_id").eq("id", input.eventId).maybeSingle();
  const { data: queued, error } = await admin.from("sms_log").insert({
    event_id: input.eventId,
    client_id: event?.client_id ?? null,
    to_number: to,
    body,
    status: "queued",
    is_marketing: classification.isMarketing,
    bypass_comms_pause: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const drained = await processSmsOutbox(admin, { onlyIds: [queued.id as string] });
  return { to, body, classification, drained };
}

async function loadTemplate(admin: SupabaseClient, id: string, sms: boolean) {
  const { data, error } = await admin.from("email_templates").select("*").eq("id", id).eq("is_active", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Template not found.");
  if (sms && !data.is_sms) throw new Error("That template is not an SMS template.");
  return data as {
    id: string;
    name: string;
    subject: string | null;
    body_html: string | null;
    updated_at: string | null;
    is_sms: boolean | null;
    sms_marketing: boolean | null;
    attach_template_id: string | null;
    attach_mode: string | null;
    branded_shell: boolean | null;
  };
}

function replaceTag(html: string, tag: string, value: string): string {
  return html.split(`<${tag}>`).join(value).split(`&lt;${tag}&gt;`).join(value);
}

async function substituteClientLinks(
  admin: SupabaseClient,
  html: string,
  template: { attach_template_id: string | null; attach_mode: string | null },
  eventId: string,
): Promise<string> {
  const { data: event } = await admin.from("events").select("pay_token").eq("id", eventId).maybeSingle();
  const payToken = (event?.pay_token as string | null) ?? "";
  let out = html;
  if (out.includes("[payment link]")) out = out.split("[payment link]").join(payToken ? `${appUrl()}/pay/${payToken}` : "");
  if (out.includes("[proposal link]") || out.includes("[journey link]")) {
    const proposal = payToken ? `${appUrl()}/proposal/${payToken}` : "";
    out = out.split("[proposal link]").join(proposal).split("[journey link]").join(proposal);
  }
  if (out.includes("[signing link]") && template.attach_template_id && (template.attach_mode ?? "esign_link") === "esign_link") {
    const { data: existing } = await admin
      .from("documents")
      .select("id, access_token, doc_type")
      .eq("event_id", eventId)
      .eq("template_id", template.attach_template_id)
      .is("signed_at", null)
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const doc = existing ?? (await generateDocumentRow(admin, template.attach_template_id, eventId, "sent"));
    const link = doc?.access_token ? `${appUrl()}/sign/${doc.access_token}` : "";
    out = out.split("[signing link]").join(link || signButtonHtml(link, `Review & Sign ${docTypeClientLabel(doc?.doc_type ?? "contract")}`));
  } else {
    out = out.split("[signing link]").join("");
  }
  return out;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function resolveTo(admin: SupabaseClient, input: { eventId: string; to: "primary_client" | "custom"; address?: string | null }) {
  if (input.to === "custom") return (input.address ?? "").trim() || null;
  const { data } = await admin.from("events").select("client:clients(email)").eq("id", input.eventId).maybeSingle();
  const client = data?.client as { email?: string | null } | { email?: string | null }[] | null;
  const row = Array.isArray(client) ? client[0] : client;
  return row?.email?.trim() || null;
}

async function resolveSmsTo(admin: SupabaseClient, input: { eventId: string; to: "primary_client" | "custom"; number?: string | null }) {
  if (input.to === "custom") return (input.number ?? "").trim() || null;
  const { data } = await admin.from("events").select("client:clients(cell_phone)").eq("id", input.eventId).maybeSingle();
  const client = data?.client as { cell_phone?: string | null } | { cell_phone?: string | null }[] | null;
  const row = Array.isArray(client) ? client[0] : client;
  return row?.cell_phone?.trim() || null;
}

async function renderTags(admin: SupabaseClient, eventId: string, template: string) {
  const { data, error } = await admin.rpc("render_merge_tags", { p_event_id: eventId, p_template: template });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? template;
}

async function resolveSender(admin: SupabaseClient, eventId: string, from: string): Promise<Sender> {
  const { data, error } = await admin.rpc("resolve_sender", { p_event_id: eventId, p_from: from });
  if (!error && data && typeof data === "object") return data as Sender;
  const { data: cs } = await admin.from("company_settings").select("from_name, from_email, reply_to").eq("id", true).maybeSingle();
  return { name: cs?.from_name ?? undefined, email: cs?.from_email ?? undefined, reply_to: cs?.reply_to ?? undefined };
}

async function smsBody(admin: SupabaseClient, input: { eventId: string; body?: string | null; templateId?: string | null }) {
  if (input.templateId) {
    const template = await loadTemplate(admin, input.templateId, true);
    const rendered = await renderTags(admin, input.eventId, template.body_html ?? "");
    return rendered.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return (input.body ?? "").trim();
}
