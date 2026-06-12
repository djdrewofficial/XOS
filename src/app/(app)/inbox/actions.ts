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

/** Reply from the inbox thread — sends an SMS through the normal outbox
    pipeline, then re-pulls the conversation so the new message appears. */
export async function sendInboxReply(conversationId: string, formData: FormData) {
  const body = (formData.get("body") ?? "").toString().trim();
  if (!body) return;

  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("hl_conversations")
    .select("id, phone, client_id")
    .eq("id", conversationId)
    .single();
  if (!conv?.phone) throw new Error("This conversation has no phone number to text.");

  const { error } = await supabase.from("sms_log").insert({
    client_id: conv.client_id,
    to_number: conv.phone,
    body,
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
