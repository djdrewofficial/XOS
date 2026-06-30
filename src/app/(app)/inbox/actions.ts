"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncHighLevelConversations,
  processSmsOutbox,
  refreshConversation,
  findConversationIdByContact,
  toE164,
} from "@/lib/highlevel";
import { buildDocumentHtml } from "@/lib/documentHtml";
import { htmlToPdf } from "@/lib/pdf";
import type { ActiveThread, ConvRow } from "@/components/InboxShell";
import type { MsgRow, ThreadDoc } from "@/components/MessageParts";

const CONV_COLS =
  "id, hl_contact_id, client_id, contact_name, phone, email, last_message_at, last_message_direction, last_message_type, last_message_body, unread_count";

/** Load a single thread (for client-side conversation switching) and clear its
    unread badge. Mirrors what the /inbox/[id] server page builds. */
export async function loadThread(id: string): Promise<ActiveThread | null> {
  await requireModule("inbox", "view", { mode: "throw" });
  const supabase = await createClient();
  const { data: conv } = await supabase.from("hl_conversations").select("*").eq("id", id).maybeSingle();
  if (!conv) return null;

  const [{ data: messages }, { data: client }] = await Promise.all([
    supabase.from("hl_messages").select("*").eq("conversation_id", id).order("date_added", { ascending: true }).limit(500),
    conv.client_id
      ? supabase.from("clients").select("id, first_name, last_name, cell_phone, email").eq("id", conv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: events } = client
    ? await supabase.from("events").select("id, name, event_date, status:event_statuses(name, color, text_color)").eq("client_id", client.id).order("event_date", { ascending: false }).limit(10)
    : { data: [] };

  const eventIds = (events ?? []).map((ev) => ev.id as string);
  const { data: docs } = eventIds.length
    ? await supabase.from("documents").select("id, title").in("event_id", eventIds).neq("status", "void").order("created_at", { ascending: false }).limit(20)
    : { data: [] };

  // clear unread so the list badge updates (best-effort, via admin)
  await createAdminClient().from("hl_conversations").update({ unread_count: 0 }).eq("id", id);

  return {
    conv: conv as ConvRow,
    messages: (messages ?? []) as MsgRow[],
    client: client ?? null,
    events: (events ?? []).map((ev) => {
      const status = ev.status as unknown as { name: string; color: string; text_color: string } | null;
      return {
        id: ev.id as string,
        name: ev.name as string,
        event_date: (ev.event_date as string) ?? null,
        status_name: status?.name ?? null,
        status_color: status?.color ?? null,
        status_text_color: status?.text_color ?? null,
      };
    }),
    ghlUrl:
      conv.hl_contact_id && process.env.HIGHLEVEL_LOCATION_ID
        ? `https://app.gohighlevel.com/v2/location/${process.env.HIGHLEVEL_LOCATION_ID}/contacts/detail/${conv.hl_contact_id}`
        : null,
    docs: (docs ?? []) as ThreadDoc[],
  };
}

/** Next page of conversations older than the given timestamp (infinite scroll). */
export async function loadMoreConversations(beforeIso: string): Promise<ConvRow[]> {
  await requireModule("inbox", "view", { mode: "throw" });
  const supabase = await createClient();
  const { data } = await supabase
    .from("hl_conversations")
    .select(CONV_COLS)
    .lt("last_message_at", beforeIso)
    .order("last_message_at", { ascending: false })
    .limit(200);
  return (data ?? []) as ConvRow[];
}

export async function syncInbox(full?: boolean) {
  await requireModule("inbox", "view", { mode: "throw" });
  const supabase = await createClient();
  await syncHighLevelConversations(supabase, { full });
  revalidatePath("/inbox");
}

/** Clients for the "New conversation" picker — loaded lazily (only when the user
    opens the composer) so the 700+ rows aren't shipped on every inbox load. */
export async function listInboxClients() {
  await requireModule("inbox", "view", { mode: "throw" });
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, first_name, last_name, cell_phone").order("first_name");
  return (data ?? []) as { id: string; first_name: string; last_name: string; cell_phone: string | null }[];
}

/** Reply from a thread on ANY channel (SMS/Email/WhatsApp/IG/FB) through the
    outbox pipeline, then re-pull the conversation so the new message appears.
    Files upload to the public sms-media bucket (unguessable uuid paths);
    an XOS document can be attached as a branded PDF (Email especially). */
export async function sendInboxReply(conversationId: string, formData: FormData) {
  await requireModule("inbox", "edit", { mode: "throw" });
  const body = (formData.get("body") ?? "").toString().trim();
  const channel = ((formData.get("channel") ?? "SMS").toString() || "SMS") as
    | "SMS" | "Email" | "WhatsApp" | "IG" | "FB" | "GMB";
  const subject = (formData.get("subject") ?? "").toString().trim() || null;
  const docId = (formData.get("attach_document_id") ?? "").toString().trim() || null;
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!body && files.length === 0 && !docId) return;

  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("hl_conversations")
    .select("id, phone, email, client_id, hl_contact_id")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversation not found.");
  if (channel === "SMS" && !conv.phone && !conv.hl_contact_id) {
    throw new Error("This conversation has no phone number to text.");
  }

  const attachments: string[] = [];
  for (const file of files.slice(0, 10)) {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error(`"${file.name}" is over 10 MB — too large to attach.`);
    }
    const path = `${crypto.randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, "")}`;
    const { error: upError } = await supabase.storage
      .from("sms-media")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upError) throw new Error(`Upload failed: ${upError.message}`);
    attachments.push(supabase.storage.from("sms-media").getPublicUrl(path).data.publicUrl);
  }

  // attach an XOS document as a branded PDF
  if (docId) {
    const built = await buildDocumentHtml(supabase, docId);
    if (!built) throw new Error("Could not render that document.");
    const pdf = await htmlToPdf(built.html);
    const filename = `${built.title.replace(/[^\w\- &']+/g, "").trim() || "Document"}.pdf`;
    const path = `${crypto.randomUUID()}/${filename}`;
    const { error: upError } = await supabase.storage
      .from("sms-media")
      .upload(path, pdf, { contentType: "application/pdf" });
    if (upError) throw new Error(`Document upload failed: ${upError.message}`);
    attachments.push(supabase.storage.from("sms-media").getPublicUrl(path).data.publicUrl);
  }

  // email replies continue the latest email chain in this conversation
  let replyToMessageId: string | null = null;
  if (channel === "Email") {
    const { data: lastEmail } = await supabase
      .from("hl_messages")
      .select("id, meta")
      .eq("conversation_id", conversationId)
      .eq("message_type", "TYPE_EMAIL")
      .order("date_added", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastEmail) {
      const ids = (lastEmail.meta as { email?: { messageIds?: string[] } } | null)?.email?.messageIds;
      replyToMessageId = ids?.[ids.length - 1] ?? lastEmail.id;
    }
  }

  const { error } = await supabase.from("sms_log").insert({
    client_id: conv.client_id,
    to_number: conv.phone,
    to_address: conv.email,
    channel,
    subject,
    hl_target_contact_id: conv.hl_contact_id,
    reply_to_message_id: replyToMessageId,
    body,
    attachments,
  });
  if (error) throw new Error(error.message);

  await processSmsOutbox(supabase);
  await refreshConversation(supabase, conversationId);
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Starts a brand-new conversation: sends the first SMS (which creates the
    GHL contact + conversation), then mirrors the thread so it shows up
    immediately. origin = "inbox" (redirects into the new thread) or an event
    id (stays on the event's Comms tab). */
export async function startConversation(formData: FormData) {
  await requireModule("inbox", "edit", { mode: "throw" });
  const body = (formData.get("body") ?? "").toString().trim();
  const phoneRaw = (formData.get("phone") ?? "").toString().trim();
  const clientId = (formData.get("client_id") ?? "").toString().trim() || null;
  const label = (formData.get("label") ?? "").toString().trim() || null;
  const origin = (formData.get("origin") ?? "inbox").toString();
  if (!body) return;
  const phone = toE164(phoneRaw);
  if (!phone) throw new Error(`"${phoneRaw}" doesn't look like a valid phone number.`);

  const supabase = await createClient();
  const { data: queuedRow, error } = await supabase
    .from("sms_log")
    .insert({ client_id: clientId, to_number: phone, body })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await processSmsOutbox(supabase);
  const { data: sent } = await supabase
    .from("sms_log")
    .select("status, error, hl_contact_id")
    .eq("id", queuedRow.id)
    .single();
  if (sent?.status !== "sent") {
    throw new Error(sent?.error ?? "The message didn't send — check the number and try again.");
  }

  // mirror the (possibly brand-new) conversation so the thread renders now
  let convId: string | null = null;
  if (sent.hl_contact_id) {
    convId = await findConversationIdByContact(sent.hl_contact_id);
    if (convId) {
      await supabase.from("hl_conversations").upsert(
        {
          id: convId,
          hl_contact_id: sent.hl_contact_id,
          client_id: clientId,
          contact_name: label,
          phone,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "id", ignoreDuplicates: true } // never clobber an existing row
      );
      await refreshConversation(supabase, convId);
    }
  }

  revalidatePath("/inbox");
  if (origin === "inbox") {
    redirect(convId ? `/inbox/${convId}` : "/inbox");
  } else {
    revalidatePath(`/events/${origin}`);
  }
}

export async function markConversationRead(conversationId: string) {
  await requireModule("inbox", "edit", { mode: "throw" });
  const supabase = await createClient();
  await supabase.from("hl_conversations").update({ unread_count: 0 }).eq("id", conversationId);
  revalidatePath("/inbox");
}
