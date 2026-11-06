"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe, requireModule } from "@/lib/auth";
import { isUuid } from "@/lib/ugcModeration";

async function staffEditor(eventId: string) {
  if (!isUuid(eventId)) throw new Error("That event was not found.");
  const supabase = await createClient();
  await requireModule("events", "edit", { mode: "throw", supabase });
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff") throw new Error("Not authorized.");
  return { supabase, me };
}

export async function setContentReportStatus(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const reportId = String(formData.get("reportId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(eventId) || !isUuid(reportId)) throw new Error("That was not found.");
  if (status !== "resolved" && status !== "dismissed") throw new Error("Missing fields.");
  const { supabase, me } = await staffEditor(eventId);
  const { error } = await supabase
    .from("event_content_reports")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: me.userId,
    })
    .eq("id", reportId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function restoreHiddenContent(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const targetType = String(formData.get("targetType") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const targetUserId = String(formData.get("targetUserId") ?? "");
  if (!isUuid(eventId) || !isUuid(targetId)) throw new Error("That was not found.");
  await staffEditor(eventId);
  const admin = createAdminClient();
  const cleared = { hidden_at: null, hidden_by: null };
  let error: { message?: string } | null = null;
  if (targetType === "song") {
    ({ error } = await admin.from("planning_songs").update(cleared).eq("id", targetId).eq("event_id", eventId));
  } else if (targetType === "song_like" && isUuid(targetUserId)) {
    ({ error } = await admin.from("planning_song_likes").update(cleared).eq("song_id", targetId).eq("account_id", targetUserId));
  } else if (targetType === "answer") {
    ({ error } = await admin.from("planning_question_answers").update(cleared).eq("question_id", targetId).eq("event_id", eventId));
  } else if (targetType === "section_note") {
    ({ error } = await admin
      .from("planning_sections")
      .update({ client_notes_hidden_at: null, client_notes_hidden_by: null })
      .eq("id", targetId)
      .eq("event_id", eventId));
  } else if (targetType === "do_not_play_note") {
    ({ error } = await admin.from("planning_do_not_play_notes").update(cleared).eq("event_id", eventId));
  } else if (targetType === "song_idea") {
    ({ error } = await admin.from("song_ideas").update(cleared).eq("id", targetId).eq("event_id", eventId));
  } else if (targetType === "cover_photo") {
    ({ error } = await admin.from("events").update({ cover_photo_hidden_at: null, cover_photo_hidden_by: null }).eq("id", eventId));
  } else if (targetType === "booth_selection") {
    ({ error } = await admin.from("event_photobooth_selection").update(cleared).eq("event_id", eventId));
  } else if (targetType === "timeline_file") {
    ({ error } = await admin.from("event_files").update(cleared).eq("id", targetId).eq("event_id", eventId));
  } else {
    throw new Error("Missing fields.");
  }
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}
