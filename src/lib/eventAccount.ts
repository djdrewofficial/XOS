import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannerRole } from "@/lib/planning";

/* Client-facing "My Event" data for the planner: package + add-ons + financials
   (mirrors the mobile app's loadAccount price logic — override → locked → live
   default; pending payments excluded from balance) plus the emails and texts
   we've sent them. Server-only; read via the admin client after a role gate. */

const num = (v: unknown): number => (typeof v === "number" ? v : v ? Number(v) : 0) || 0;

export type AccountAddon = { name: string; detail: string | null; price: number; qty: number };
export type AccountPayment = { id: string; amount: number; paidAt: string | null; method: string | null; reason: string | null; pending: boolean };
export type AccountSchedule = { id: string; label: string | null; dueDate: string | null; amount: number; seq: number };

export type EventAccount = {
  financialsVisible: boolean;
  packageName: string | null;
  packageDescription: string | null;
  includedHours: number | null;
  packagePrice: number;
  addons: AccountAddon[];
  travelFee: number;
  overtimeFee: number;
  discounts: { label: string; amount: number }[];
  total: number;
  paid: number;
  balance: number;
  billingTerms: string | null;
  payments: AccountPayment[];
  schedule: AccountSchedule[];
};

export type SentEmail = { id: string; subject: string | null; to: string | null; status: string | null; sentAt: string | null; openedAt: string | null };
export type SentText = { id: string; body: string | null; to: string | null; status: string | null; sentAt: string | null };

export async function loadEventAccount(admin: SupabaseClient, eventId: string, role: PlannerRole): Promise<EventAccount | null> {
  const { data: ev } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!ev) return null;

  let typeHide = false;
  if (ev.event_type_id) {
    const { data: et } = await admin.from("event_types").select("hide_financials").eq("id", ev.event_type_id).maybeSingle();
    typeHide = !!et?.hide_financials;
  }
  const hidden = ev.hide_financials ?? typeHide;
  // Staff always see; hosts respect the per-event/type hide flag.
  const financialsVisible = role === "staff" || !hidden;

  const { data: eAddons } = await admin.from("event_addons").select("addon_id, quantity, price_override, price_locked").eq("event_id", eventId);
  const pays = financialsVisible
    ? (await admin.from("payments").select("id, amount, status, paid_at, method, reason").eq("event_id", eventId).order("paid_at", { ascending: true })).data
    : null;
  const sched = financialsVisible
    ? (await admin.from("scheduled_payments").select("id, seq, due_date, amount, label").eq("event_id", eventId).order("seq", { ascending: true })).data
    : null;

  let packageName: string | null = null, packageDescription: string | null = null, includedHours: number | null = null, pkgDefault = 0;
  if (ev.package_id) {
    const { data: pkg } = await admin.from("packages").select("name, client_facing_name, description, included_hours, default_price").eq("id", ev.package_id).maybeSingle();
    if (pkg) {
      packageName = pkg.client_facing_name || pkg.name;
      packageDescription = pkg.description ?? null;
      includedHours = pkg.included_hours ?? null;
      pkgDefault = num(pkg.default_price);
    }
  }
  const packagePrice = financialsVisible ? num(ev.package_price_override) || num(ev.package_price_locked) || pkgDefault : 0;

  const addonIds = (eAddons ?? []).map((a) => a.addon_id).filter(Boolean);
  const meta = new Map<string, { name: string; description: string | null; default_price: number }>();
  if (addonIds.length) {
    const { data: m } = await admin.from("addons").select("id, name, client_facing_name, description, default_price").in("id", addonIds);
    for (const x of m ?? []) meta.set(x.id, { name: x.client_facing_name || x.name, description: x.description ?? null, default_price: num(x.default_price) });
  }
  const addons: AccountAddon[] = (eAddons ?? []).map((a) => {
    const mm = meta.get(a.addon_id);
    const unit = num(a.price_override) || num(a.price_locked) || (mm?.default_price ?? 0);
    const qty = a.quantity ?? 1;
    return { name: mm?.name ?? "Add-on", detail: mm?.description ?? null, price: financialsVisible ? unit * qty : 0, qty };
  });

  const travelFee = financialsVisible ? num(ev.travel_fee) : 0;
  const overtimeFee = financialsVisible ? num(ev.overtime_fee) : 0;
  const discounts = financialsVisible
    ? [
        { label: ev.discount1_label || "Discount", amount: num(ev.discount1_amount) },
        { label: ev.discount2_label || "Discount", amount: num(ev.discount2_amount) },
      ].filter((d) => d.amount > 0)
    : [];

  const addonsTotal = addons.reduce((s, a) => s + a.price, 0);
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const total = packagePrice + addonsTotal + travelFee + overtimeFee - discountTotal;

  const payments: AccountPayment[] = (pays ?? []).map((p) => ({
    id: p.id, amount: num(p.amount), paidAt: p.paid_at, method: p.method, reason: p.reason, pending: p.status === "pending",
  }));
  const paid = payments.filter((p) => !p.pending).reduce((s, p) => s + p.amount, 0);
  const balance = total - paid;
  const schedule: AccountSchedule[] = (sched ?? []).map((s) => ({ id: s.id, label: s.label, dueDate: s.due_date, amount: num(s.amount), seq: s.seq ?? 0 }));

  return {
    financialsVisible, packageName, packageDescription, includedHours, packagePrice, addons, travelFee, overtimeFee,
    discounts, total, paid, balance, billingTerms: financialsVisible ? ev.billing_terms ?? null : null, payments, schedule,
  };
}

export async function loadClientMessages(admin: SupabaseClient, eventId: string): Promise<{ emails: SentEmail[]; texts: SentText[] }> {
  const [{ data: em }, { data: sms }] = await Promise.all([
    admin.from("email_log").select("id, subject, to_address, status, sent_at, created_at, opened_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(30),
    admin.from("sms_log").select("id, body, to_number, status, sent_at, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    emails: (em ?? []).map((e) => ({ id: e.id, subject: e.subject, to: e.to_address, status: e.status, sentAt: e.sent_at ?? e.created_at, openedAt: e.opened_at })),
    texts: (sms ?? []).map((s) => ({ id: s.id, body: s.body, to: s.to_number, status: s.status, sentAt: s.sent_at ?? s.created_at })),
  };
}
