"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe, requireModule } from "@/lib/auth";
import { notifyAssignment } from "@/lib/taskNotify";
import { syncRecent, firefliesConfigured } from "@/lib/fireflies";

/* Fireflies actions for the event page: approve/dismiss a suggested task (approve →
   a real task in the Tasks Manager), attach/unlink a call to this event, and sync
   recent meetings from Fireflies. All guarded by the events module. */

const nowIso = () => new Date().toISOString();

/** Approve a suggested task → create a real task linked to this event + notify assignee. */
export async function approveSuggestion(eventId: string, suggestionId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const me = await getMe(supabase);

  const { data: s } = await supabase
    .from("fireflies_suggested_tasks")
    .select("id,text,status,suggested_employee_id,meeting:fireflies_meetings(title,client_id)")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!s || s.status !== "suggested") return;
  const meeting = s.meeting as unknown as { title: string | null; client_id: string | null } | null;

  const assignee = (s.suggested_employee_id as string) ?? null;
  let department: string | null = null;
  if (assignee) {
    const { data } = await supabase.from("employees").select("staff_category").eq("id", assignee).maybeSingle();
    department = (data?.staff_category as string) ?? null;
  }

  const { data: task } = await supabase
    .from("tasks")
    .insert({
      title: s.text,
      body: meeting?.title ? `From Fireflies call: ${meeting.title}` : "From a Fireflies call",
      assigned_employee_id: assignee,
      department,
      event_id: eventId,
      client_id: meeting?.client_id ?? null,
      created_by: me?.employeeId ?? null,
      priority: "normal",
    })
    .select("id")
    .maybeSingle();

  await supabase
    .from("fireflies_suggested_tasks")
    .update({ status: "approved", task_id: task?.id ?? null, decided_by: me?.employeeId ?? null, decided_at: nowIso() })
    .eq("id", suggestionId);

  if (assignee && assignee !== me?.employeeId && task?.id) {
    await notifyAssignment(assignee, task.id as string, s.text as string);
  }
  revalidatePath(`/events/${eventId}`);
}

export async function dismissSuggestion(eventId: string, suggestionId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const me = await getMe(supabase);
  await supabase
    .from("fireflies_suggested_tasks")
    .update({ status: "dismissed", decided_by: me?.employeeId ?? null, decided_at: nowIso() })
    .eq("id", suggestionId);
  revalidatePath(`/events/${eventId}`);
}

/** Manually attach a call to this event (email match missed or was ambiguous). */
export async function attachMeetingToEvent(eventId: string, meetingId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("client_id").eq("id", eventId).maybeSingle();
  const { data: m } = await supabase.from("fireflies_meetings").select("client_id").eq("id", meetingId).maybeSingle();
  await supabase
    .from("fireflies_meetings")
    .update({ event_id: eventId, client_id: (m?.client_id as string) ?? (ev?.client_id as string) ?? null, matched_by: "manual", updated_at: nowIso() })
    .eq("id", meetingId);
  revalidatePath(`/events/${eventId}`);
}

export async function unlinkMeeting(eventId: string, meetingId: string) {
  await requireModule("events", "edit", { mode: "throw" });
  const supabase = await createClient();
  await supabase.from("fireflies_meetings").update({ event_id: null, matched_by: "manual", updated_at: nowIso() }).eq("id", meetingId);
  revalidatePath(`/events/${eventId}`);
}

/** Pull recent meetings from Fireflies and auto-match by email. */
export async function syncFireflies(eventId: string): Promise<{ imported: number; error?: string }> {
  await requireModule("events", "edit", { mode: "throw" });
  if (!firefliesConfigured()) return { imported: 0, error: "Fireflies isn't connected yet (FIREFLIES_API_KEY missing on the server)." };
  try {
    const admin = createAdminClient();
    const res = await syncRecent(admin, { limit: 25 });
    revalidatePath(`/events/${eventId}`);
    return res;
  } catch (e) {
    return { imported: 0, error: e instanceof Error ? e.message : "Sync failed." };
  }
}
