import type { SupabaseClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";

type Sender = { name?: string; email?: string; reply_to?: string };

/** Preview a template send without queueing it. Recipient and rendered subject
    only — the body can contain client details, so the preview keeps a short note
    instead of the full HTML. */
export async function previewTemplateEmail(
  admin: SupabaseClient,
  input: { eventId: string; templateId: string; to: "primary_client" | "custom"; address?: string | null },
) {
  const template = await loadTemplate(admin, input.templateId, false);
  const to = await resolveTo(admin, input);
  const subject = await renderTags(admin, input.eventId, template.subject ?? "");
  return {
    template: template.name,
    to,
    subject,
    attaches_document: Boolean(template.attach_template_id),
    is_sms: template.is_sms === true,
    note: "Nothing has been sent. Confirming queues this through the booking-helper email path and then runs the outbox, which fills quote, payment-plan, and sign-link tags.",
  };
}

/** Queue one email the way a booking helper's send_email action does (database
    merge tags + template id), then run processOutbox so the TypeScript tags and
    the contract attachment are applied. bypass_comms_pause is true because this
    is an explicit manual send, same as a staff helper click. */
export async function sendTemplateEmail(
  admin: SupabaseClient,
  input: { eventId: string; templateId: string; to: "primary_client" | "custom"; address?: string | null; from?: string | null },
) {
  const template = await loadTemplate(admin, input.templateId, false);
  if (template.is_sms) throw new Error("That template is a text, not an email.");
  const to = await resolveTo(admin, input);
  if (!to) throw new Error("No recipient email address.");
  const sender = await resolveSender(admin, input.eventId, input.from ?? "company");
  const subject = await renderTags(admin, input.eventId, template.subject ?? "");
  const body = await renderTags(admin, input.eventId, template.body_html ?? "");
  const { data: event } = await admin.from("events").select("client_id").eq("id", input.eventId).maybeSingle();
  const { error } = await admin.from("email_log").insert({
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
  });
  if (error) throw new Error(error.message);
  const drained = await processOutbox(admin);
  return { to, subject, drained };
}

export async function previewSms(
  admin: SupabaseClient,
  input: { eventId: string; body?: string | null; templateId?: string | null; to: "primary_client" | "custom"; number?: string | null },
) {
  const to = await resolveSmsTo(admin, input);
  const body = await smsBody(admin, input);
  return {
    to,
    body,
    note: "Nothing has been sent. Confirming queues an SMS and sends it through the HighLevel outbox.",
  };
}

export async function sendSms(
  admin: SupabaseClient,
  input: { eventId: string; body?: string | null; templateId?: string | null; to: "primary_client" | "custom"; number?: string | null },
) {
  const to = await resolveSmsTo(admin, input);
  if (!to) throw new Error("No mobile number to text.");
  const body = await smsBody(admin, input);
  if (!body.trim()) throw new Error("The text is empty.");
  const { data: event } = await admin.from("events").select("client_id").eq("id", input.eventId).maybeSingle();
  let isMarketing = false;
  if (input.templateId) {
    const template = await loadTemplate(admin, input.templateId, true);
    isMarketing = template.sms_marketing === true;
  }
  const { error } = await admin.from("sms_log").insert({
    event_id: input.eventId,
    client_id: event?.client_id ?? null,
    to_number: to,
    body,
    status: "queued",
    is_marketing: isMarketing,
    bypass_comms_pause: true,
  });
  if (error) throw new Error(error.message);
  const drained = await processSmsOutbox(admin);
  return { to, drained };
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
    is_sms: boolean | null;
    sms_marketing: boolean | null;
    attach_template_id: string | null;
  };
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
