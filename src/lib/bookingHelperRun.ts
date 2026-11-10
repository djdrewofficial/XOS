import type { SupabaseClient } from "@supabase/supabase-js";
import { helperAllowedForEventType, helperAllowedForFieldStaff, helperAllowedForRole } from "@/lib/helperAccess";

export type HelperSmsPrompt = {
  index: number;
  kind: "client" | "custom" | "staff";
  label: string;
  template: string | null;
  recipients: { name: string | null; phone: string }[];
  body: string;
};

export type HelperSmsOverride = { skip?: boolean; body?: string };

const SMS_BODY_MAX = 1600;

export function cleanSmsOverrides(overrides?: Record<string, HelperSmsOverride> | null): Record<string, HelperSmsOverride> | null {
  if (!overrides) return null;
  const out: Record<string, HelperSmsOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^\d+$/.test(key) || !value) continue;
    if (value.skip) {
      out[key] = { skip: true };
      continue;
    }
    const body = (value.body ?? "").trim().slice(0, SMS_BODY_MAX);
    if (body) out[key] = { body };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** What a helper would text, without sending. Same RPC the event page uses. */
export async function previewHelperSms(admin: SupabaseClient, eventId: string, helperId: string): Promise<HelperSmsPrompt[]> {
  const { data, error } = await admin.rpc("preview_helper_sms", {
    p_helper_id: helperId,
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as HelperSmsPrompt[];
}

/** The event-page helper button. The database queues the helper's actions
    (including contract emails, with database merge tags filled). This function
    then runs the app outbox so quote, payment-plan, and sign-link tags are
    filled in TypeScript and the message actually goes out. Calling only the
    database function leaves those tags blank. */
export async function executeBookingHelper(
  admin: SupabaseClient,
  input: {
    eventId: string;
    helperId: string;
    smsOverrides?: Record<string, HelperSmsOverride> | null;
    actorRole: string | null;
    /** Field staff (employee / marketing tier). Enforced even when enforceRole is false. */
    actorFieldStaff?: boolean;
    /** Staff clicks pass true. A service token is not a staff role; the token
        scopes are the authorization, and the event-type limit still applies. */
    enforceRole: boolean;
  },
): Promise<{ title: string }> {
  const [{ data: scope }, { data: ev }] = await Promise.all([
    admin.from("booking_helpers").select("title, visible_event_type_ids, allowed_roles").eq("id", input.helperId).maybeSingle(),
    admin.from("events").select("event_type_id").eq("id", input.eventId).maybeSingle(),
  ]);
  if (!scope) throw new Error("Helper not found.");
  if (!ev) throw new Error("Event not found.");
  if (!helperAllowedForEventType(scope, ev.event_type_id as string | null)) {
    throw new Error(`"${scope.title}" isn't set up for this event type.`);
  }
  if (input.enforceRole && !helperAllowedForRole(scope, input.actorRole)) {
    throw new Error(`Your role can't run "${scope.title}".`);
  }
  if (input.actorFieldStaff && !helperAllowedForFieldStaff(scope, input.actorRole)) {
    throw new Error(`Your role can't run "${scope.title}".`);
  }
  const queuedSince = new Date().toISOString();
  const { error } = await admin.rpc("run_booking_helper", {
    p_helper_id: input.helperId,
    p_event_id: input.eventId,
    p_sms_overrides: cleanSmsOverrides(input.smsOverrides),
  });
  if (error) throw new Error(error.message);
  // Loaded here so the role and event-type guards above can run without the mail stack.
  const [{ fireHelperWebhook }, { drainEventOutbox }] = await Promise.all([import("@/lib/automations"), import("@/lib/scopedOutbox")]);
  await fireHelperWebhook(admin, input.helperId, input.eventId);
  await drainEventOutbox(admin, input.eventId, queuedSince);
  return { title: scope.title as string };
}
