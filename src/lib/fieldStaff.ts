/* Field-staff guards for server code that runs with the SERVICE-ROLE client
   (createAdminClient bypasses RLS, so the database's field-staff rules from
   migrations 00217/00218 don't protect those paths). Call these before any
   admin-client work done on behalf of a signed-in user.

   Field staff = Me.fieldStaff (employee / marketing tier). Office tiers always
   pass. The rules match the database:
     - events: only events the caller is assigned to (event_staff.employee_id)
     - conversations: only clients of events where the caller's assignment role
       contains "DJ" (xos_dj_client_ids()) */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/auth";

type Client = SupabaseClient;

/** True when the caller may act on this event: office, or field staff assigned to it. */
export async function canTouchEvent(sb: Client, me: Me | null, eventId: string): Promise<boolean> {
  if (!me || me.accountType !== "staff") return false;
  if (!me.fieldStaff) return true;
  if (!me.employeeId || !eventId) return false;
  // own event_staff rows stay readable to field staff under 00218
  const { data } = await sb
    .from("event_staff")
    .select("id")
    .eq("event_id", eventId)
    .eq("employee_id", me.employeeId)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Throwing form for server actions. */
export async function requireEventTouch(sb: Client, me: Me | null, eventId: string): Promise<void> {
  if (!(await canTouchEvent(sb, me, eventId))) throw new Error("Not authorized for this event.");
}

/** Throws for field staff — office-only server actions (money, documents, create/delete). */
export function requireOffice(me: Me | null): void {
  if (!me || me.accountType !== "staff" || me.fieldStaff) throw new Error("Not authorized.");
}

/** Client ids a field-staff caller may message (xos_dj_client_ids, migration 00217).
    Fails closed (empty) if the function isn't there yet. */
export async function djClientIds(sb: Client): Promise<string[]> {
  const { data, error } = await sb.rpc("xos_dj_client_ids");
  if (error || !Array.isArray(data)) return [];
  return (data as unknown[])
    .map((r) => (typeof r === "string" ? r : (r as { xos_dj_client_ids?: string })?.xos_dj_client_ids))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** True when the caller may read/send on a conversation with this client. */
export async function canMessageClient(sb: Client, me: Me | null, clientId: string | null | undefined): Promise<boolean> {
  if (!me || me.accountType !== "staff") return false;
  if (!me.fieldStaff) return true;
  if (!clientId) return false;
  return (await djClientIds(sb)).includes(clientId);
}
