import type { SupabaseClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";

/* Automation dispatcher — the keystone of the trigger→action engine. Lifecycle
   moments (event created, proposal confirmed, document signed, payment received,
   status changed) call runAutomations(); it finds the booking helpers wired to
   that trigger (scoped by event type), runs each via the existing
   run_booking_helper() engine, then fires the helper's optional Zapier webhook.
   Nothing about WHICH automations run is hardcoded — it's all helper config. */

export type AutomationTrigger =
  | "event_created"
  | "proposal_confirmed"
  | "document_signed"
  | "payment_received"
  | "status_changed";

type HelperRow = {
  id: string;
  webhook_url: string | null;
  event_type_ids: string[] | null;
  auto_on_create: boolean;
  auto_status_ids: string[] | null;
  auto_on_proposal_confirmed: boolean;
  auto_on_signed: boolean;
  auto_on_payment: boolean;
};

export async function runAutomations(
  supabase: SupabaseClient,
  eventId: string,
  trigger: AutomationTrigger,
  opts: { statusId?: string } = {}
): Promise<void> {
  const { data: ev } = await supabase
    .from("events")
    .select("event_type_id, status_id, archived_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return;
  // archived events are frozen — no helper runs, webhooks, or queued sends
  if (ev.archived_at) return;

  const { data: helpers } = await supabase
    .from("booking_helpers")
    .select(
      "id, webhook_url, event_type_ids, auto_on_create, auto_status_ids, auto_on_proposal_confirmed, auto_on_signed, auto_on_payment"
    )
    .eq("is_active", true);

  const statusId = opts.statusId ?? (ev.status_id as string | null);
  const matched = ((helpers ?? []) as HelperRow[]).filter((h) => {
    if ((h.event_type_ids?.length ?? 0) > 0 && ev.event_type_id && !h.event_type_ids!.includes(ev.event_type_id as string))
      return false;
    switch (trigger) {
      case "event_created":
        return h.auto_on_create;
      case "proposal_confirmed":
        return h.auto_on_proposal_confirmed;
      case "document_signed":
        return h.auto_on_signed;
      case "payment_received":
        return h.auto_on_payment;
      case "status_changed":
        return !!statusId && (h.auto_status_ids ?? []).includes(statusId);
      default:
        return false;
    }
  });
  if (matched.length === 0) return;

  let ran = false;
  for (const h of matched) {
    try {
      // run_booking_helper enforces its own visibility + one-shot guards (raises
      // if it shouldn't run) — skip those quietly
      await supabase.rpc("run_booking_helper", { p_helper_id: h.id, p_event_id: eventId });
    } catch {
      continue;
    }
    ran = true;
    if (h.webhook_url) {
      try {
        await fireWebhook(supabase, h.webhook_url, eventId, trigger);
      } catch {
        /* webhooks are fire-and-forget */
      }
    }
  }

  // deliver anything the helpers queued (emails/SMS)
  if (ran) {
    try {
      await processOutbox(supabase);
      await processSmsOutbox(supabase);
    } catch {
      /* the outbox cron retries */
    }
  }
}

type ClientLite = { first_name?: string; last_name?: string; email?: string | null; cell_phone?: string | null } | null;

/** Fire a single helper's webhook (used when a helper is run manually — handy
    for testing a Zap from the event page without signing a contract). */
export async function fireHelperWebhook(supabase: SupabaseClient, helperId: string, eventId: string): Promise<void> {
  const { data: h } = await supabase.from("booking_helpers").select("webhook_url").eq("id", helperId).maybeSingle();
  const url = (h?.webhook_url as string | null) ?? null;
  if (url) {
    try {
      await fireWebhook(supabase, url, eventId, "manual");
    } catch {
      /* fire-and-forget */
    }
  }
}

/** POST a useful event snapshot to a Zapier hook (powers Vibo, Drive, etc.). */
async function fireWebhook(supabase: SupabaseClient, url: string, eventId: string, trigger: string): Promise<void> {
  const { data: e } = await supabase
    .from("events")
    .select(
      "id, event_number, name, event_date, start_time, end_time, guest_count, pay_token, event_type:event_types(name), venue:venues(name, address, city, state, zip), client:clients(first_name, last_name, email, cell_phone), event_clients(is_primary, role, client:clients(first_name, last_name, email, cell_phone))"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!e) return;

  const clients = ((e.event_clients ?? []) as { is_primary: boolean; role: string | null; client: ClientLite }[]).map((ec) => ({
    role: ec.role,
    is_primary: ec.is_primary,
    first_name: ec.client?.first_name ?? null,
    last_name: ec.client?.last_name ?? null,
    email: ec.client?.email ?? null,
    cell_phone: ec.client?.cell_phone ?? null,
  }));

  const payload = {
    trigger,
    event: {
      id: e.id,
      number: e.event_number,
      name: e.name,
      type: (e.event_type as { name?: string } | null)?.name ?? null,
      date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      guest_count: e.guest_count,
      pay_token: e.pay_token,
    },
    venue: e.venue ?? null,
    primary_client: e.client ?? null,
    clients,
  };

  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
