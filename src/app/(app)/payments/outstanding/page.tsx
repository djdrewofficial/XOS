import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/* Outstanding Balances (A/R): locked-in events (Financials-counting statuses)
   with money still owed, aged by their next unpaid scheduled payment. */

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

export default async function OutstandingPage() {
  const supabase = await createClient();
  const today = todayISO();

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, name, event_date, archived_at, package_price_override, package_price_locked, overtime_fee, travel_fee, discount1_amount, discount2_amount, " +
        "status:event_statuses(name, color, text_color, counts_financial), client:clients(first_name, last_name, cell_phone), " +
        "package:packages(default_price), venue:venues(setup_fee), " +
        "event_addons(quantity, price_override, price_locked, addon:addons(default_price)), " +
        "payments(amount, status, scheduled_payment_id), scheduled_payments(id, seq, due_date, amount, label)"
    )
    .limit(5000);

  type Row = {
    id: string;
    name: string;
    client: string;
    eventDate: string | null;
    status: { name: string; color: string; text_color: string } | null;
    total: number;
    paid: number;
    balance: number;
    nextDue: { date: string | null; amount: number } | null;
    overdueDays: number; // >0 = overdue, 0 = not
  };

  const rows: Row[] = [];
  for (const ev of (events ?? []) as unknown as Array<Record<string, unknown>>) {
    if (ev.archived_at) continue;
    const st = ev.status as { name?: string; color?: string; text_color?: string; counts_financial?: boolean } | null;
    if (!st?.counts_financial) continue;

    const addonsTotal = ((ev.event_addons ?? []) as Array<Record<string, unknown>>).reduce((s, a) => {
      const unit = (a.price_override as number) ?? (a.price_locked as number) ?? (a.addon as { default_price?: number } | null)?.default_price ?? 0;
      return s + Number(a.quantity) * Number(unit);
    }, 0);
    const venueSetup = Number((ev.venue as { setup_fee?: number } | null)?.setup_fee ?? 0);
    const total = eventTotal(ev as unknown as XEvent) + addonsTotal + venueSetup;

    const pays = ((ev.payments ?? []) as Array<{ amount: number; status: string; scheduled_payment_id: string | null }>).filter((p) => p.status === "approved");
    const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Math.round((total - paid) * 100) / 100;
    if (balance <= 0.01) continue;

    const taken = new Set(pays.map((p) => p.scheduled_payment_id).filter(Boolean));
    const sched = ((ev.scheduled_payments ?? []) as Array<{ id: string; seq: number; due_date: string | null; amount: number }>).sort((a, b) => a.seq - b.seq);
    const next = sched.find((s) => !taken.has(s.id)) ?? null;
    const overdueDays = next?.due_date && next.due_date < today ? daysBetween(next.due_date, today) : 0;

    const c = ev.client as { first_name?: string; last_name?: string } | null;
    rows.push({
      id: ev.id as string,
      name: (ev.name as string) || "(unnamed)",
      client: c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "—",
      eventDate: (ev.event_date as string) ?? null,
      status: st.name ? { name: st.name, color: st.color!, text_color: st.text_color! } : null,
      total,
      paid,
      balance,
      nextDue: next ? { date: next.due_date, amount: Number(next.amount) } : null,
      overdueDays,
    });
  }

  // overdue first (most overdue on top), then by soonest event date
  rows.sort((a, b) => {
    if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
    return (a.eventDate ?? "9999") < (b.eventDate ?? "9999") ? -1 : 1;
  });

  const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0);
  const overdueTotal = rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.balance, 0);

  return (
    <div className="max-w-6xl">
      <h1 className="mb-1 text-2xl font-bold">Outstanding Balances</h1>
      <p className="mb-4 text-xs text-zinc-500">Locked-in events (Financials-counting statuses) with a balance due, aged by next unpaid scheduled payment.</p>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-amber-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">Total Outstanding</div>
          <div className="text-2xl font-black text-amber-900 dark:text-amber-100">{money(totalOutstanding)}</div>
        </div>
        <div className="rounded-lg bg-red-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-red-700 dark:text-red-300">Overdue</div>
          <div className="text-2xl font-black text-red-900 dark:text-red-200">{money(overdueTotal)}</div>
        </div>
        <div className="rounded-lg bg-zinc-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Events Owing</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white">{rows.length}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Event Date</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-left">Next Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {rows.map((r) => (
              <tr key={r.id} className={r.overdueDays > 0 ? "bg-red-50/60 dark:bg-red-500/[0.06]" : ""}>
                <td className="px-3 py-2">
                  <Link href={`/events/${r.id}`} className="font-medium text-brand hover:underline dark:text-brand-lighter">{r.name}</Link>
                  {r.status && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: r.status.color, color: r.status.text_color }}>{r.status.name}</span>
                  )}
                </td>
                <td className="px-3 py-2">{r.client}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.eventDate ? fmt(r.eventDate) : "—"}</td>
                <td className="px-3 py-2 text-right">{money(r.total)}</td>
                <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{money(r.paid)}</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300">{money(r.balance)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.overdueDays > 0 ? (
                    <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">Overdue {r.overdueDays}d</span>
                  ) : r.nextDue?.date ? (
                    <span className="text-zinc-600 dark:text-zinc-300">{money(r.nextDue.amount)} · {fmt(r.nextDue.date)}</span>
                  ) : (
                    <span className="text-zinc-400">no schedule</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-zinc-500">No outstanding balances 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
