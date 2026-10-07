"use client";

import { useMemo, useState, useTransition } from "react";
import { saveRemainingSchedule, acknowledgeScheduleTotal } from "@/app/(app)/events/actions";

type Row = { id: string | null; amount: string; due_date: string; label: string };
type Locked = { id: string; amount: number; due_date: string | null; label: string | null };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/* Shown on the event when its total no longer matches the payment schedule
   (an add-on/price/fee changed after a schedule was set or a payment came in).
   Paid installments stay locked; the office reshapes only what's left. */
export default function ScheduleRebalance({
  eventId,
  total,
  scheduleSum,
  locked,
  open,
}: {
  eventId: string;
  total: number;
  scheduleSum: number;
  locked: Locked[];
  open: { id: string; amount: number; due_date: string | null; label: string | null }[];
}) {
  const target = round2(total - locked.reduce((s, r) => s + Number(r.amount), 0));
  const diff = round2(total - scheduleSum);
  const initial: Row[] = open.map((r) => ({ id: r.id, amount: Number(r.amount).toFixed(2), due_date: r.due_date ?? "", label: r.label ?? "" }));
  const [rows, setRows] = useState<Row[]>(initial);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sum = useMemo(() => round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)), [rows]);
  const off = round2(target - sum);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // quick fills — always start from the current installments
  const addToLast = () =>
    setRows(() => {
      if (initial.length === 0) return [{ id: null, amount: target.toFixed(2), due_date: "", label: "" }];
      const rs = initial.map((r) => ({ ...r }));
      const last = rs[rs.length - 1];
      last.amount = round2(Number(last.amount) + (target - round2(rs.reduce((s, r) => s + Number(r.amount), 0)))).toFixed(2);
      return rs;
    });
  const addToNext = () =>
    setRows(() => {
      if (initial.length === 0) return [{ id: null, amount: target.toFixed(2), due_date: "", label: "" }];
      const rs = initial.map((r) => ({ ...r }));
      rs[0].amount = round2(Number(rs[0].amount) + (target - round2(rs.reduce((s, r) => s + Number(r.amount), 0)))).toFixed(2);
      return rs;
    });
  const spread = () =>
    setRows(() => {
      if (initial.length === 0) return [{ id: null, amount: target.toFixed(2), due_date: "", label: "" }];
      const n = initial.length;
      const each = Math.floor((target / n) * 100) / 100;
      return initial.map((r, i) => ({ ...r, amount: (i === n - 1 ? round2(target - each * (n - 1)) : each).toFixed(2) }));
    });

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveRemainingSchedule(
          eventId,
          rows.map((r) => ({ id: r.id, amount: Number(r.amount) || 0, due_date: r.due_date || null })),
        );
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save the schedule.");
      }
    });
  }

  return (
    <div id="schedule-rebalance" className="mb-5 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
            ⚠️ The event total changed — update the remaining payments?
          </div>
          <div className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            Total is now <strong>{money(total)}</strong>, but the payment schedule adds up to{" "}
            <strong>{money(scheduleSum)}</strong> ({diff > 0 ? "+" : ""}
            {money(diff)}). Paid installments stay as they are.
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <button type="button" onClick={() => { setRows(initial); setEditing(true); }} className="btn-primary px-4 py-1.5 text-xs">
              Update remaining payments
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => { await acknowledgeScheduleTotal(eventId); })}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Keep as is
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm dark:bg-zinc-900">
          {locked.length > 0 && (
            <ul className="mb-2 space-y-1 text-xs text-zinc-500">
              {locked.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>🔒 {r.label ?? "Payment"} · {r.due_date ?? "—"} · paid</span>
                  <span>{money(Number(r.amount))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="self-center text-[11px] font-semibold text-zinc-500">Quick fill:</span>
            <button type="button" onClick={addToNext} className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] hover:border-brand dark:border-white/15">
              Difference on next payment
            </button>
            <button type="button" onClick={addToLast} className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] hover:border-brand dark:border-white/15">
              Difference on final payment
            </button>
            <button type="button" onClick={spread} className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] hover:border-brand dark:border-white/15">
              Spread evenly
            </button>
          </div>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={r.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs text-zinc-500">{r.id ? r.label || `Payment ${i + 1}` : "New payment"}</span>
                <input type="date" value={r.due_date} onChange={(e) => set(i, { due_date: e.target.value })} className="input w-40 text-xs" />
                <input
                  type="number"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => set(i, { amount: e.target.value })}
                  className="input w-28 text-xs"
                />
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-[11px] text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { id: null, amount: Math.max(off, 0).toFixed(2), due_date: "", label: "" }])}
              className="text-[11px] font-semibold text-brand hover:underline dark:text-brand-lighter"
            >
              + Add a payment
            </button>
          </div>
          <div className={`mt-2 text-xs font-semibold ${Math.abs(off) < 0.01 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            Remaining payments: {money(sum)} of {money(target)} needed
            {Math.abs(off) >= 0.01 ? ` (${off > 0 ? "short" : "over"} ${money(Math.abs(off))})` : " ✓"}
          </div>
          {error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={pending || Math.abs(off) >= 0.01} onClick={save} className="btn-primary px-4 py-1.5 text-xs disabled:opacity-50">
              {pending ? "Saving…" : "Save payment schedule"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-3 py-1.5 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
