"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  syncHighLevelConversations,
  processSmsOutbox,
  refreshConversation,
} from "@/lib/highlevel";

export async function syncInbox(full?: boolean) {
  const supabase = await createClient();
  await syncHighLevelConversations(supabase, { full });
  revalidatePath("/inbox");
}

/** Reply from the inbox thread — sends an SMS/MMS through the normal outbox
    pipeline, then re-pulls the conversation so the new message appears.
    Files are uploaded to the public sms-media bucket (unguessable uuid paths)
    so HighLevel and the carriers can fetch them. */
export async function sendInboxReply(conversationId: string, formData: FormData) {
  const body = (formData.get("body") ?? "").toString().trim();
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!body && files.length === 0) return;

  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("hl_conversations")
    .select("id, phone, client_id")
    .eq("id", conversationId)
    .single();
  if (!conv?.phone) throw new Error("This conversation has no phone number to text.");

  const attachments: string[] = [];
  for (const file of files.slice(0, 10)) {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error(`"${file.name}" is over 10 MB — too large for MMS.`);
    }
    const path = `${crypto.randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, "")}`;
    const { error: upError } = await supabase.storage
      .from("sms-media")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upError) throw new Error(`Upload failed: ${upError.message}`);
    attachments.push(supabase.storage.from("sms-media").getPublicUrl(path).data.publicUrl);
  }

  const { error } = await supabase.from("sms_log").insert({
    client_id: conv.client_id,
    to_number: conv.phone,
    body,
    attachments,
  });
  if (error) throw new Error(error.message);

  await processSmsOutbox(supabase);
  await refreshConversation(supabase, conversationId);
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

export async function markConversationRead(conversationId: string) {
  const supabase = await createClient();
  await supabase.from("hl_conversations").update({ unread_count: 0 }).eq("id", conversationId);
  revalidatePath("/inbox");
}
