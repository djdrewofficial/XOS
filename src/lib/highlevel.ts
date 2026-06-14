import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/* ============ HighLevel (LeadConnector API v2) config ============
   Set in .env.local (and Netlify env for prod):
     HIGHLEVEL_PI_TOKEN    — sub-account Settings → Private Integrations
                             (scopes: Contacts read/write, Conversations/Messages write)
     HIGHLEVEL_LOCATION_ID — the sub-account id
   SMS goes through a GHL contact, so sending is: upsert contact by phone →
   POST the message. Replies thread into the GHL Conversations inbox. */

const API_BASE = "https://services.leadconnectorhq.com";

function highlevelConfig() {
  return {
    token: process.env.HIGHLEVEL_PI_TOKEN,
    locationId: process.env.HIGHLEVEL_LOCATION_ID,
  };
}

export function isHighLevelConfigured(): boolean {
  const { token, locationId } = highlevelConfig();
  return !!(token && locationId);
}

/** US-centric E.164 normalization — GHL matches/creates contacts by phone. */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

async function hlFetch(
  path: string,
  version: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const { token } = highlevelConfig();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** Find-or-create the GHL contact for this phone number. */
async function upsertContact(opts: {
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const { locationId } = highlevelConfig();
  const result = await hlFetch("/contacts/upsert", "2021-07-28", {
    locationId,
    phone: opts.phone,
    ...(opts.firstName ? { firstName: opts.firstName } : {}),
    ...(opts.lastName ? { lastName: opts.lastName } : {}),
    ...(opts.email ? { email: opts.email } : {}),
  });
  if (!result.ok) return result;
  const contact = result.data.contact as { id?: string } | undefined;
  if (!contact?.id) return { ok: false, error: "upsert returned no contact id" };
  return { ok: true, contactId: contact.id };
}

export type CommChannel = "SMS" | "Email" | "WhatsApp" | "IG" | "FB" | "GMB";

/** Plain text → simple email HTML (line breaks preserved, links clickable by clients). */
function textToEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<div style="font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#2c2c33;">${escaped}</div>`;
}

/** Low-level send to an existing GHL contact on any conversation channel.
    attachments = publicly fetchable URLs (the sms-media bucket / GHL CDN). */
async function sendConversationMessage(
  contactId: string,
  opts: {
    channel: CommChannel;
    body: string;
    subject?: string | null;
    toEmail?: string | null;
    attachments?: string[];
    replyMessageId?: string | null;
  }
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    type: opts.channel,
    contactId,
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  };
  if (opts.channel === "Email") {
    payload.html = textToEmailHtml(opts.body);
    if (opts.replyMessageId) {
      // continue the existing email chain — GHL threads it and handles "Re:"
      payload.replyMessageId = opts.replyMessageId;
      if (opts.subject) payload.subject = opts.subject;
    } else {
      payload.subject = opts.subject || "Message from Xpress Entertainment";
    }
    if (opts.toEmail) payload.emailTo = opts.toEmail;
  } else {
    payload.message = opts.body;
  }
  const result = await hlFetch("/conversations/messages", "2021-04-15", payload);
  if (!result.ok) return result;
  const id = (result.data.messageId ?? result.data.msg ?? null) as string | null;
  return { ok: true, messageId: typeof id === "string" ? id : null };
}

/* ============ Conversation sync (Communications Hub) ============
   Polls GHL conversations into hl_conversations / hl_messages, keyed by GHL
   ids (idempotent upserts). A watermark in hl_sync_state keeps incremental
   runs cheap; conversations link to XOS clients by cell phone / email. */

type HlConversation = {
  id: string;
  contactId?: string;
  contactName?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  lastMessageDate?: number; // epoch ms
  lastMessageType?: string;
  lastMessageDirection?: string;
  lastMessageBody?: string;
  unreadCount?: number;
};

type HlMessage = {
  id: string;
  direction?: string;
  messageType?: string;
  status?: string;
  body?: string;
  from?: string;
  to?: string;
  dateAdded?: string;
  conversationId?: string;
  meta?: Record<string, unknown>;
  attachments?: unknown[];
  callDuration?: number;
  callStatus?: string;
};

/** last-10-digits key for matching GHL contacts to XOS clients by phone */
function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** GHL stores full email content at a dedicated endpoint; the messages list
    only carries a stub. The email-record id hides in meta.email.messageIds. */
function emailIdOf(meta: Record<string, unknown> | undefined, fallback: string): string {
  const ids = (meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds;
  return ids?.[ids.length - 1] ?? fallback;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchEmailContent(
  emailMessageId: string
): Promise<{ subject: string | null; bodyText: string | null; bodyHtml: string | null } | null> {
  const result = await hlFetch(`/conversations/messages/email/${emailMessageId}`, "2021-04-15");
  if (!result.ok) return null;
  const d = result.data as { subject?: string; body?: string };
  const html = d.body ?? null;
  return {
    subject: d.subject ?? null,
    bodyHtml: html ? html.slice(0, 100_000) : null,
    bodyText: html ? stripHtml(html) : null,
  };
}

async function fetchConversationMessages(conversationId: string): Promise<HlMessage[]> {
  const result = await hlFetch(
    `/conversations/${conversationId}/messages?limit=100`,
    "2021-04-15"
  );
  if (!result.ok) return [];
  const wrapper = result.data.messages as { messages?: HlMessage[] } | HlMessage[] | undefined;
  if (Array.isArray(wrapper)) return wrapper;
  return wrapper?.messages ?? [];
}

async function upsertConversationMessages(
  supabase: SupabaseClient,
  conversationId: string
): Promise<number> {
  const messages = await fetchConversationMessages(conversationId);
  if (!messages.length) return 0;
  const rows = messages.map((m) => ({
    id: m.id,
    conversation_id: conversationId,
    direction: m.direction ?? null,
    message_type: m.messageType ?? null,
    status: m.status ?? null,
    body: m.body ?? null,
    from_number: m.from ?? null,
    to_number: m.to ?? null,
    date_added: m.dateAdded ?? null,
    meta: {
      ...(m.meta ?? {}),
      ...(m.callDuration != null ? { callDuration: m.callDuration } : {}),
      ...(m.callStatus ? { callStatus: m.callStatus } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    } as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  }));

  // emails arrive as stubs — pull full content (subject + body) for the ones
  // we haven't enriched yet, and never clobber bodies fetched earlier
  const emailStubs = rows.filter((r) => r.message_type === "TYPE_EMAIL" && !r.body);
  if (emailStubs.length) {
    const { data: existing } = await supabase
      .from("hl_messages")
      .select("id, body, meta")
      .in("id", emailStubs.map((r) => r.id));
    const known = new Map((existing ?? []).map((e) => [e.id as string, e]));
    let fetched = 0;
    for (const row of emailStubs) {
      const prev = known.get(row.id);
      if (prev?.body) {
        row.body = prev.body as string;
        row.meta = { ...((prev.meta ?? {}) as Record<string, unknown>), ...row.meta };
        continue;
      }
      if (fetched >= 10) continue; // cap per call — older ones fill in on later opens
      fetched++;
      const content = await fetchEmailContent(emailIdOf(row.meta, row.id));
      if (content?.bodyText) {
        row.body = content.bodyText;
        row.meta = { ...row.meta, subject: content.subject, emailHtml: content.bodyHtml };
      }
    }
  }

  await supabase.from("hl_messages").upsert(rows, { onConflict: "id" });
  return rows.length;
}

/** The GHL conversation for a contact — used right after the first outbound
    text creates one, so the new thread can be mirrored and opened. */
export async function findConversationIdByContact(contactId: string): Promise<string | null> {
  const { locationId } = highlevelConfig();
  const result = await hlFetch(
    `/conversations/search?locationId=${locationId}&contactId=${contactId}`,
    "2021-04-15"
  );
  if (!result.ok) return null;
  const convs = (result.data.conversations ?? []) as { id?: string }[];
  return convs[0]?.id ?? null;
}

/** Refreshes a single conversation (used right after sending an inbox reply). */
export async function refreshConversation(
  supabase: SupabaseClient,
  conversationId: string
): Promise<void> {
  await upsertConversationMessages(supabase, conversationId);
  const { data: latest } = await supabase
    .from("hl_messages")
    .select("message_type, direction, body, date_added")
    .eq("conversation_id", conversationId)
    .order("date_added", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    await supabase
      .from("hl_conversations")
      .update({
        last_message_at: latest.date_added,
        last_message_type: latest.message_type,
        last_message_direction: latest.direction,
        last_message_body: latest.body?.slice(0, 500) ?? null,
        synced_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  }
}

/** Incremental (or full) pull of GHL conversations into XOS.
    Walks newest-first and stops once it's past the watermark. */
export async function syncHighLevelConversations(
  client?: SupabaseClient,
  opts?: { full?: boolean; maxPages?: number; claimSeconds?: number }
): Promise<{ conversations: number; messages: number; skipped: string | null; error?: string }> {
  if (!isHighLevelConfigured()) {
    return { conversations: 0, messages: 0, skipped: "HighLevel not configured" };
  }
  const supabase = client ?? (await createClient());
  const { locationId } = highlevelConfig();

  const { data: state } = await supabase
    .from("hl_sync_state")
    .select("last_message_watermark, last_synced_at")
    .eq("id", true)
    .maybeSingle();

  // run claim: skip if another sync started moments ago (page loads can stack;
  // the realtime tick uses a short window so the inbox stays near-live)
  const claimSeconds = opts?.claimSeconds ?? 90;
  if (!opts?.full && state?.last_synced_at) {
    const sinceMs = Date.now() - new Date(state.last_synced_at).getTime();
    if (sinceMs < claimSeconds * 1000) {
      return { conversations: 0, messages: 0, skipped: "synced moments ago" };
    }
  }
  await supabase
    .from("hl_sync_state")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", true);
  // 1h overlap so late status updates (delivered/read) on recent messages get re-pulled
  const watermarkMs =
    !opts?.full && state?.last_message_watermark
      ? new Date(state.last_message_watermark).getTime() - 60 * 60 * 1000
      : 0;

  // clients lookup for phone/email matching (single-tenant scale: load once)
  const { data: clientRows } = await supabase.from("clients").select("id, cell_phone, email");
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of clientRows ?? []) {
    const key = phoneKey(c.cell_phone);
    if (key && !byPhone.has(key)) byPhone.set(key, c.id);
    const em = (c.email ?? "").trim().toLowerCase();
    if (em && !byEmail.has(em)) byEmail.set(em, c.id);
  }

  let conversations = 0;
  let messages = 0;
  let newestSeen = watermarkMs;
  let startAfterDate: number | null = null;
  const maxPages = opts?.full ? 30 : (opts?.maxPages ?? 5);

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      locationId: locationId!,
      limit: "100",
      sortBy: "last_message_date",
      sort: "desc",
    });
    if (startAfterDate != null) params.set("startAfterDate", String(startAfterDate));
    const result = await hlFetch(`/conversations/search?${params}`, "2021-04-15");
    if (!result.ok) {
      return { conversations, messages, skipped: null, error: result.error };
    }
    const batch = (result.data.conversations ?? []) as HlConversation[];
    if (!batch.length) break;

    let reachedWatermark = false;
    for (const conv of batch) {
      const lastMs = conv.lastMessageDate ?? 0;
      if (lastMs > newestSeen) newestSeen = lastMs;
      if (lastMs <= watermarkMs) {
        reachedWatermark = true;
        break;
      }
      const clientId =
        (phoneKey(conv.phone) ? byPhone.get(phoneKey(conv.phone)!) : undefined) ??
        byEmail.get((conv.email ?? "").trim().toLowerCase()) ??
        null;
      await supabase.from("hl_conversations").upsert(
        {
          id: conv.id,
          hl_contact_id: conv.contactId ?? null,
          client_id: clientId,
          contact_name: conv.contactName ?? conv.fullName ?? null,
          phone: conv.phone ?? null,
          email: conv.email ?? null,
          last_message_at: lastMs ? new Date(lastMs).toISOString() : null,
          last_message_type: conv.lastMessageType ?? null,
          last_message_direction: conv.lastMessageDirection ?? null,
          last_message_body: conv.lastMessageBody?.slice(0, 500) ?? null,
          unread_count: conv.unreadCount ?? 0,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      messages += await upsertConversationMessages(supabase, conv.id);
      conversations++;
    }
    if (reachedWatermark || batch.length < 100) break;
    startAfterDate = batch[batch.length - 1].lastMessageDate ?? null;
    if (startAfterDate == null) break;
  }

  await supabase
    .from("hl_sync_state")
    .update({
      last_message_watermark: newestSeen ? new Date(newestSeen).toISOString() : null,
      last_synced_at: new Date().toISOString(),
      last_result: { conversations, messages },
    })
    .eq("id", true);

  return { conversations, messages, skipped: null };
}

/** Drains queued rows from sms_log through HighLevel.
    Pass a service-role client when running without a user session (cron, sign flow). */
export async function processSmsOutbox(
  client?: SupabaseClient
): Promise<{ sent: number; failed: number; skipped: string | null }> {
  if (!isHighLevelConfigured()) {
    return {
      sent: 0,
      failed: 0,
      skipped: "HighLevel not configured (set HIGHLEVEL_PI_TOKEN and HIGHLEVEL_LOCATION_ID)",
    };
  }

  const supabase = client ?? (await createClient());
  const { data: queued } = await supabase
    .from("sms_log")
    .select("*, client:clients(first_name, last_name, email)")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);

  let sent = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    const fail = async (error: string) => {
      await supabase.from("sms_log").update({ status: "failed", error }).eq("id", msg.id);
      failed++;
    };

    // resolve the GHL contact: channel replies carry it directly (IG/FB have
    // no phone number); SMS sends fall back to phone upsert
    let contactId: string | null = msg.hl_target_contact_id ?? null;
    if (!contactId) {
      const phone = toE164(msg.to_number ?? "");
      if (!phone) {
        await fail(`invalid phone number: ${msg.to_number}`);
        continue;
      }
      const cl = msg.client as { first_name?: string; last_name?: string; email?: string } | null;
      const contact = await upsertContact({
        phone,
        firstName: cl?.first_name,
        lastName: cl?.last_name,
        email: cl?.email,
      });
      if (!contact.ok) {
        await fail(`contact upsert: ${contact.error}`);
        continue;
      }
      contactId = contact.contactId;
    }

    const result = await sendConversationMessage(contactId, {
      channel: (msg.channel ?? "SMS") as CommChannel,
      body: msg.body,
      subject: msg.subject,
      toEmail: msg.to_address,
      attachments: msg.attachments ?? [],
      replyMessageId: msg.reply_to_message_id ?? null,
    });
    if (result.ok) {
      await supabase
        .from("sms_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          hl_contact_id: contactId,
          provider_message_id: result.messageId,
          error: null,
        })
        .eq("id", msg.id);
      sent++;
    } else {
      await fail(result.error);
    }
  }

  return { sent, failed, skipped: null };
}
