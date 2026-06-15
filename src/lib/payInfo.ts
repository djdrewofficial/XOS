import type { SupabaseClient } from "@supabase/supabase-js";
import { eventTotal, type XEvent } from "@/lib/types";

/* What a public pay page (and the create-order endpoint) needs: the event
   behind a pay_token and what's owed. Total math mirrors the event page:
   eventTotal (package + fees − discounts) + add-ons + venue setup fee. */

export type PaySettings = {
  onlinePayEnabled: boolean;
  paypalEnabled: boolean;
  paypalFeePct: number;
  zelleEnabled: boolean;
  zelleDisplayName: string;
  zelleHandle: string | null;
  zelleMemo: string;
  welcomeHeading: string;
  welcomeBody: string; // HTML, may contain merge tags
  confetti: boolean;
};

export type PayInfo = {
  eventId: string;
  eventName: string | null;
  eventDate: string | null;
  firstName: string | null;
  clientEmail: string | null;
  total: number;
  paid: number;
  balance: number;
  suggested: number; // prefill: the next uncovered scheduled payment, capped at balance
  hasInstallments: boolean; // more than one scheduled payment → autopay is offerable
  autopayArmed: boolean; // a card is already vaulted for this event
  settings: PaySettings;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds the PayPal surcharge for a displayed/charged amount. */
export function withFee(base: number, feePct: number): number {
  return round2(base * (1 + feePct / 100));
}

export async function loadPayInfo(supabase: SupabaseClient, token: string): Promise<PayInfo | null> {
  const { data: event } = await supabase
    .from("events")
    .select(
      "*, client:clients(first_name, last_name, email), package:packages(default_price), venue:venues(setup_fee)"
    )
    .eq("pay_token", token)
    .maybeSingle();
  if (!event) return null;

  const [{ data: addons }, { data: payments }, { data: scheduled }, { data: pset }, { data: jset }] =
    await Promise.all([
      supabase
        .from("event_addons")
        .select("quantity, price_override, price_locked, addon:addons(default_price)")
        .eq("event_id", event.id),
      supabase.from("payments").select("amount, scheduled_payment_id").eq("event_id", event.id),
      supabase.from("scheduled_payments").select("id, seq, amount").eq("event_id", event.id).order("seq"),
      supabase.from("payment_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("journey_settings").select("*").eq("id", true).maybeSingle(),
    ]);

  const addonsTotal = (addons ?? []).reduce((s, a) => {
    const unit = a.price_override ?? a.price_locked ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
    return s + Number(a.quantity) * Number(unit);
  }, 0);
  const venueSetup = Number((event.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);

  const total = eventTotal(event as unknown as XEvent) + addonsTotal + venueSetup;
  const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const taken = new Set((payments ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
  const nextSched = (scheduled ?? []).find((s) => !taken.has(s.id));
  const suggested = Math.min(balance, Number(nextSched?.amount ?? balance)) || balance;

  const client = event.client as { first_name?: string; last_name?: string; email?: string } | null;
  const ps = (pset ?? {}) as Record<string, unknown>;
  const js = (jset ?? {}) as Record<string, unknown>;
  const settings: PaySettings = {
    onlinePayEnabled: ps.online_pay_enabled !== false,
    paypalEnabled: ps.paypal_pay_enabled !== false,
    paypalFeePct: Number(ps.paypal_fee_pct ?? 4),
    zelleEnabled: ps.zelle_pay_enabled !== false,
    zelleDisplayName: (ps.zelle_display_name as string) ?? "Xpress Entertainment",
    zelleHandle: (ps.zelle_handle as string) ?? null,
    zelleMemo: (ps.zelle_memo as string) ?? "Include your event date in the memo",
    welcomeHeading: (js.welcome_heading as string) ?? "Welcome to the Xpress Entertainment family! 🎉",
    welcomeBody: (js.welcome_body as string) ?? "",
    confetti: js.confetti !== false,
  };

  return {
    eventId: event.id as string,
    eventName: (event.name as string) ?? null,
    eventDate: (event.event_date as string) ?? null,
    firstName: client?.first_name ?? null,
    clientEmail: client?.email ?? null,
    total: round2(total),
    paid: round2(paid),
    balance: round2(balance),
    suggested: round2(suggested),
    hasInstallments: (scheduled ?? []).length > 1,
    autopayArmed: !!(event as { autopay_vault_id?: string | null }).autopay_vault_id,
    settings,
  };
}
