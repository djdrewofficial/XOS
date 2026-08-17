/* Server-only helpers that surface task events to staff through the existing
   Notification System: an in-app bell row (create_targeted_notification, SECURITY
   DEFINER, service-role only per migration 00166) plus a best-effort Expo push.
   Imported only from "use server" actions and the cron route — never client code. */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendExpoPush } from "@/lib/notify";
import type { SupabaseClient } from "@supabase/supabase-js";

async function bellAndPush(
  admin: SupabaseClient,
  employeeId: string,
  title: string,
  body: string | null,
  href: string | null,
): Promise<void> {
  try {
    await admin.rpc("create_targeted_notification", {
      p_type: "staff_task",
      p_title: title,
      p_body: body,
      p_href: href,
      p_target_employee: employeeId,
      p_target_roles: [],
    });
  } catch (e) {
    console.error("[taskNotify] bell failed", e);
  }
  try {
    const { data } = await admin
      .from("device_tokens")
      .select("expo_push_token")
      .eq("employee_id", employeeId)
      .eq("is_active", true);
    const msgs = (data ?? [])
      .map((t) => ({ to: t.expo_push_token as string, title, body: body ?? "", sound: "default", data: href ? { href } : {} }))
      .filter((m) => m.to);
    if (msgs.length) await sendExpoPush(msgs);
  } catch (e) {
    console.error("[taskNotify] push failed", e);
  }
}

/** Notify a staffer that a task was assigned to them. Skips empty ids. */
export async function notifyAssignment(employeeId: string | null, taskId: string, taskTitle: string): Promise<void> {
  if (!employeeId) return;
  const admin = createAdminClient();
  await bellAndPush(admin, employeeId, "New task assigned to you", taskTitle, `/tasks?task=${taskId}`);
}

/** Notify each staffer @mentioned in a comment. */
export async function notifyMentions(
  employeeIds: string[],
  taskId: string,
  taskTitle: string,
  actorName: string,
): Promise<void> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length === 0) return;
  const admin = createAdminClient();
  for (const id of ids) {
    await bellAndPush(admin, id, `${actorName} mentioned you`, taskTitle, `/tasks?task=${taskId}`);
  }
}

/** Bulk-notify assignees of freshly auto-generated tasks (from the rule engine). */
export async function notifyAssignments(
  tasks: { id: string; title: string; assigned_employee_id: string | null }[],
): Promise<void> {
  const withAssignee = tasks.filter((t) => t.assigned_employee_id);
  if (withAssignee.length === 0) return;
  const admin = createAdminClient();
  for (const t of withAssignee) {
    await bellAndPush(admin, t.assigned_employee_id as string, "New task assigned to you", t.title, `/tasks?task=${t.id}`);
  }
}
