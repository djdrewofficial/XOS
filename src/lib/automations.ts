import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";
import { reseedEventPlanning } from "@/lib/planning";
import { dispatchNotification } from "@/lib/notify";
import {
  evaluateOnPaymentSkip,
  isPaypalThankYouSubject,
  onPaymentSkipLogAction,
} from "@/lib/onPaymentHelperSkip";

/* Automation dispatcher — the keystone of the trigger→action engine. Lifecycle
   moments (event created, proposal confirmed, document signed, payment received,
   status changed) call runAutomations(); it finds the booking helpers wired to
   that trigger (scoped by event type), runs each via the existing
   run_booking_helper() engine, then fires the helper's optional Zapier webhook.
   Nothing about WHICH automations run is hardcoded — it's all helper config.

   payment_received is only fired from new payment inserts / pending→approved
   confirms (no backfill). On-payment skip flags (hidden financials / PayPal
   thank-you already sent) apply here only — manual helper clicks use
   executeBookingHelper / the 3-arg RPC and are never blocked by those flags. */

export type AutomationTrigger =
  | "event_created"
  | "proposal_confirmed"
  | "document_signed"
  | "payment_received"
  | "status_changed";

type HelperRow = {
  id: string;
  title?: string | null;
  webhook_url: string | null;
  event_type_ids: string[] | null;
  auto_on_create: boolean;
  auto_status_ids: string[] | null;
  auto_on_proposal_confirmed: boolean;
  auto_on_signed: boolean;
  auto_on_payment: boolean;
  on_payment_skip_hidden_financials?: boolean | null;
  on_payment_skip_paypal_thanked?: boolean | null;
  planning_template_id: string | null;
};

export async function runAutomations(
  supabase: SupabaseClient,
  eventId: string,
  trigger: AutomationTrigger,
  opts: { statusId?: string; paymentId?: string; drain?: "all" | "event" | "hold" } = {}
): Promise<void> {
  const { data: ev } = await supabase
    .from("events")
    .select("event_type_id, status_id, archived_at, planning_template_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return;
  // archived events are frozen — no helper runs, webhooks, or queued sends
  if (ev.archived_at) return;

  // Fan out the matching notification (bell/push/email/SMS per Notification
  // Settings) — independent of whether any booking helper matches this trigger.
  const NOTIF_FOR_TRIGGER: Partial<Record<AutomationTrigger, string>> = {
    event_created: "event_created",
    proposal_confirmed: "proposal_confirmed",
    document_signed: "agreement_signed",
    payment_received: "payment_received",
    status_changed: "event_status_changed",
  };
  const notifType = NOTIF_FOR_TRIGGER[trigger];
  const holdAdmin = opts.drain === "hold" ? createAdminClient() : null;
  if (notifType && opts.drain === "hold") {
    const notice = await dispatchNotification(supabase, notifType, { eventId, statusId: opts.statusId, hold: true });
    const effects = [
      ...notice.bells.map((bell) => ({ event_id: eventId, kind: "bell", payload: bell, payload_sha: createHash("sha256").update(JSON.stringify(bell)).digest("hex"), status: "held" })),
      ...notice.pushes.map((push) => ({ event_id: eventId, kind: "push", payload: push, payload_sha: createHash("sha256").update(JSON.stringify(push)).digest("hex"), status: "held" })),
    ];
    if (effects.length) {
      const { error } = await holdAdmin!.from("mcp_held_effects").insert(effects);
      if (error) throw new Error(`Holding the staff notification needs migration 00223. Nothing was sent. ${error.message}`);
    }
  } else if (notifType) {
    await dispatchNotification(supabase, notifType, { eventId, statusId: opts.statusId });
  }

  const { data: helpers } = await supabase
    .from("booking_helpers")
    .select(
      "id, title, webhook_url, event_type_ids, auto_on_create, auto_status_ids, auto_on_proposal_confirmed, auto_on_signed, auto_on_payment, on_payment_skip_hidden_financials, on_payment_skip_paypal_thanked, planning_template_id"
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

  // Resolve payment + skip context once for on-payment helpers (insert/confirm
  // paths only — there is no payment backfill that calls this trigger).
  let paymentCtx: {
    financialsHidden: boolean;
    payment: { id: string; method: string | null; paypal_capture_id?: string | null } | null;
    paypalThankYouLogged: boolean;
  } | null = null;
  if (trigger === "payment_received") {
    paymentCtx = await loadOnPaymentSkipContext(supabase, eventId, opts.paymentId);
  }

  let ran = false;
  const queuedSince = new Date().toISOString();
  // A matched helper can assign a planning template. Apply once: only reseed when
  // it actually changes the event's template (so it never wipes planning twice).
  const desiredTemplate = matched.find((h) => h.planning_template_id)?.planning_template_id ?? null;
  if (desiredTemplate && desiredTemplate !== ev.planning_template_id) {
    try {
      await reseedEventPlanning(eventId, desiredTemplate);
    } catch {
      /* template assignment is best-effort */
    }
  }

  // run_booking_helper is SECURITY DEFINER and no longer executable by the
  // `authenticated` role (migration 00166), so invoke it via the service-role
  // client — runAutomations is called from staff actions AND public token flows,
  // both of which are already authorized before reaching here.
  const admin = createAdminClient();
  for (const h of matched) {
    if (trigger === "payment_received" && paymentCtx) {
      const decision = evaluateOnPaymentSkip(h, paymentCtx);
      if (decision.skip && decision.reason) {
        try {
          await admin.from("event_logs").insert({
            event_id: eventId,
            actor: "system",
            action: onPaymentSkipLogAction(h.title ?? "Helper", decision.reason),
          });
        } catch {
          /* logging must not block the rest of the fan-out */
        }
        continue;
      }
    }
    try {
      // 2-arg form: this is an automation, so queued mail stays subject to
      // events.comms_paused. run_booking_helper enforces its own visibility +
      // one-shot guards (raises if it shouldn't run) — skip those quietly.
      const { error } = opts.drain === "hold"
        ? await admin.rpc("mcp_run_helper_held", { p_helper_id: h.id, p_event_id: eventId })
        : await admin.rpc("run_booking_helper", { p_helper_id: h.id, p_event_id: eventId });
      if (error) {
        if (opts.drain === "hold" && /schema cache|could not find|does not exist/i.test(error.message)) {
          throw new Error("Holding onboarding mail needs migration 00222. Nothing was sent.");
        }
        if (!/already|visibility|one-shot|should not/i.test(error.message)) throw new Error(error.message);
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.drain === "hold" && /schema cache|could not find|does not exist|00222/i.test(message)) throw err;
      continue;
    }
    ran = true;
    if (opts.drain === "hold" && h.webhook_url) {
      const webhookPayload = { helper_id: h.id, webhook_url: h.webhook_url, trigger, event_id: eventId };
      const { error: effectError } = await admin.from("mcp_held_effects").insert({
        event_id: eventId,
        kind: "webhook",
        payload: webhookPayload,
        payload_sha: createHash("sha256").update(JSON.stringify(webhookPayload)).digest("hex"),
        status: "held",
      });
      if (effectError) throw new Error(`Holding the webhook needs migration 00223. Nothing was sent. ${effectError.message}`);
    } else if (h.webhook_url) {
      try {
        await fireWebhook(supabase, h.webhook_url, eventId, trigger);
      } catch {
        /* webhooks are fire-and-forget */
      }
    }
  }

  // deliver anything the helpers queued (emails/SMS). "event" sends only rows
  // queued for this event after this call started, not the whole outbox.
  if (ran && opts.drain !== "hold") {
    try {
      if (opts.drain === "event") {
        const { drainEventOutbox } = await import("@/lib/scopedOutbox");
        await drainEventOutbox(admin, eventId, queuedSince);
      } else {
        await processOutbox(supabase);
        await processSmsOutbox(supabase);
      }
    } catch {
      /* the outbox cron retries */
    }
  }
}

type ClientLite = { first_name?: string; last_name?: string; email?: string | null; cell_phone?: string | null } | null;

/** Fire a single helper's webhook (used when a helper is run manually — handy
    for testing a Zap from the event page without signing a contract). */
export async function postApprovedWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The approved webhook is not a URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("The approved webhook must be https.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(parsed.hostname)) throw new Error("The approved webhook host is not public.");
  const body = JSON.stringify(payload);
  if (body.includes("pay_token")) throw new Error("The approved webhook payload must not include a pay token.");
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error" });
  if (!response.ok) throw new Error(`Webhook delivery failed (${response.status}).`);
}

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

/** Load the payment that just triggered payment_received and whether a PayPal
    thank-you was already logged for it. Prefer opts.paymentId; otherwise the
    latest approved payment on the event (same moment as the insert/confirm). */
async function loadOnPaymentSkipContext(
  supabase: SupabaseClient,
  eventId: string,
  paymentId?: string,
): Promise<{
  financialsHidden: boolean;
  payment: { id: string; method: string | null; paypal_capture_id?: string | null } | null;
  paypalThankYouLogged: boolean;
}> {
  const { data: hidden } = await supabase.rpc("event_financials_hidden", { p_event_id: eventId });
  const financialsHidden = hidden === true;

  type PayRow = { id: string; method: string | null; paypal_capture_id?: string | null; created_at?: string | null };
  let payment: PayRow | null = null;
  if (paymentId) {
    const { data } = await supabase
      .from("payments")
      .select("id, method, paypal_capture_id, created_at")
      .eq("id", paymentId)
      .eq("event_id", eventId)
      .maybeSingle();
    payment = data;
  }
  if (!payment) {
    const { data } = await supabase
      .from("payments")
      .select("id, method, paypal_capture_id, created_at")
      .eq("event_id", eventId)
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    payment = data;
  }

  let paypalThankYouLogged = false;
  if (payment?.id) {
    const { data: byPayment } = await supabase
      .from("email_log")
      .select("id, subject")
      .eq("payment_id", payment.id)
      .limit(20);
    paypalThankYouLogged = (byPayment ?? []).some((row) => isPaypalThankYouSubject(row.subject as string));

    // Fallback for thank-yous logged before email_log.payment_id existed: same
    // event, matching subject, no payment_id, created at/after this payment.
    if (!paypalThankYouLogged && payment.created_at) {
      const { data: recent } = await supabase
        .from("email_log")
        .select("id, subject, created_at, payment_id")
        .eq("event_id", eventId)
        .is("template_id", null)
        .is("payment_id", null)
        .gte("created_at", payment.created_at)
        .order("created_at", { ascending: false })
        .limit(10);
      paypalThankYouLogged = (recent ?? []).some((row) => isPaypalThankYouSubject(row.subject as string));
    }
  }

  return { financialsHidden, payment, paypalThankYouLogged };
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
