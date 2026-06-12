"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/types";

type Preview = {
  event: {
    id: string;
    name: string;
    event_date: string | null;
    setup_time: string | null;
    start_time: string | null;
    end_time: string | null;
    guest_count: number | null;
    deposit_value: number;
    overtime_fee: number;
    travel_fee: number;
    discount1_amount: number;
    discount2_amount: number;
    package_price_override: number | null;
    package_price_locked?: number | null;
    internal_notes: string | null;
    custom_fields: Record<string, string>;
    event_type: { name: string } | null;
    status: { name: string; color: string; text_color: string } | null;
    client: { id: string; first_name: string; last_name: string; cell_phone: string | null; email: string | null } | null;
    venue: { name: string; address: string | null; city: string | null } | null;
    package: { name: string; default_price: number } | null;
  };
  payments: { id: string; amount: number; paid_at: string; method: string }[];
  schedule: { id: string; seq: number; label: string | null; due_date: string | null; amount: number }[];
  staff: { id: string; role: string; employee: { first_name: string; last_name: string } | null }[];
  notes: { id: string; body: string; created_at: string }[];
};

const TABS = ["Overview", "Client", "Financials", "Staff"] as const;

export default function EventChip({
  eventId,
  label,
  bg,
  fg,
}: {
  eventId: string;
  label: string;
  bg: string;
  fg: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: event }, { data: payments }, { data: schedule }, { data: staff }, { data: notes }] =
      await Promise.all([
        supabase
          .from("events")
          .select(
            "id, name, event_date, setup_time, start_time, end_time, guest_count, deposit_value, overtime_fee, travel_fee, discount1_amount, discount2_amount, package_price_override, package_price_locked, internal_notes, custom_fields, event_type:event_types(name), status:event_statuses(name, color, text_color), client:clients(id, first_name, last_name, cell_phone, email), venue:venues(name, address, city), package:packages(name, default_price)"
          )
          .eq("id", eventId)
          .single(),
        supabase.from("payments").select("id, amount, paid_at, method").eq("event_id", eventId).order("paid_at"),
        supabase.from("scheduled_payments").select("id, seq, label, due_date, amount").eq("event_id", eventId).order("seq"),
        supabase.from("event_staff").select("id, role, employee:employees(first_name, last_name)").eq("event_id", eventId),
        supabase.from("event_notes").select("id, body, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(5),
      ]);
    if (event) {
      setData({
        event: event as unknown as Preview["event"],
        payments: (payments ?? []) as Preview["payments"],
        schedule: (schedule ?? []) as Preview["schedule"],
        staff: (staff ?? []) as unknown as Preview["staff"],
        notes: (notes ?? []) as Preview["notes"],
      });
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    if (open && !data) void load();
  }, [open, data, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const e = data?.event;
  const total = e
    ? (e.package_price_override ?? e.package_price_locked ?? e.package?.default_price ?? 0) +
      e.overtime_fee +
      e.travel_fee -
      e.discount1_amount -
      e.discount2_amount
    : 0;
  const paid = (data?.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const rowCls = "flex justify-between text-sm";
  const dtCls = "text-zinc-500";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold shadow-sm transition-transform hover:scale-[1.03]"
        style={{ backgroundColor: bg, color: fg }}
        title={label}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-lg overflow-hidden bg-white/95 dark:bg-zinc-950/95"
            onClick={(ev) => ev.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 dark:border-white/[0.08] px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{e?.name || label}</h3>
                <p className="text-xs text-zinc-500">
                  {e?.event_date ?? ""} · {e?.event_type?.name ?? ""} {e?.venue ? `· ${e.venue.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {e?.status && (
                  <span className="chip" style={{ backgroundColor: e.status.color, color: e.status.text_color }}>
                    {e.status.name}
                  </span>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1 text-zinc-500 transition-colors hover:bg-black/10 dark:hover:bg-black/[0.07] dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* mini tabs */}
            <div className="flex gap-1 border-b border-zinc-200 dark:border-white/[0.08] px-3 py-2">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    tab === t
                      ? "bg-gradient-to-r from-brand to-brand-light text-white"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* body */}
            <div className="max-h-80 overflow-y-auto px-5 py-4">
              {loading && <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>}

              {!loading && e && tab === "Overview" && (
                <div className="space-y-2">
                  <div className={rowCls}><span className={dtCls}>Date</span><span className="font-semibold">{e.event_date ?? "—"}</span></div>
                  <div className={rowCls}><span className={dtCls}>Setup</span><span>{e.setup_time ?? "—"}</span></div>
                  <div className={rowCls}><span className={dtCls}>Start / End</span><span>{e.start_time ?? "—"} – {e.end_time ?? "—"}</span></div>
                  <div className={rowCls}><span className={dtCls}>Guests</span><span>{e.guest_count ?? "—"}</span></div>
                  <div className={rowCls}><span className={dtCls}>Venue</span><span>{e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : "—"}</span></div>
                  <div className={rowCls}><span className={dtCls}>Package</span><span>{e.package?.name ?? "—"}</span></div>
                  {e.internal_notes && (
                    <p className="rounded-lg bg-amber-400/10 p-2 text-xs text-amber-900 dark:text-amber-100">{e.internal_notes}</p>
                  )}
                  {data!.notes.length > 0 && (
                    <div className="pt-1">
                      <div className="label-xs">Recent Notes</div>
                      {data!.notes.map((n) => (
                        <p key={n.id} className="mb-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.05] p-2 text-xs text-zinc-700 dark:text-zinc-300">{n.body}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!loading && e && tab === "Client" && (
                <div className="space-y-2">
                  {e.client ? (
                    <>
                      <div className={rowCls}><span className={dtCls}>Name</span><span className="font-semibold">{e.client.first_name} {e.client.last_name}</span></div>
                      <div className={rowCls}><span className={dtCls}>Cell</span><span>{e.client.cell_phone ?? "—"}</span></div>
                      <div className={rowCls}><span className={dtCls}>Email</span><span>{e.client.email ?? "—"}</span></div>
                      <Link href={`/clients/${e.client.id}`} className="inline-block pt-1 text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
                        View client profile →
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-zinc-500">No client linked.</p>
                  )}
                </div>
              )}

              {!loading && e && tab === "Financials" && (
                <div className="space-y-2">
                  <div className={rowCls}><span className={dtCls}>Total Fee</span><span className="font-semibold">{money(total)}</span></div>
                  <div className={rowCls}><span className={dtCls}>Payments Received</span><span className="text-emerald-600 dark:text-emerald-400">{money(paid)}</span></div>
                  <div className={rowCls}><span className="font-semibold">Balance Due</span><span className="font-black text-zinc-900 dark:text-white">{money(total - paid)}</span></div>
                  {data!.schedule.length > 0 && (
                    <div className="pt-2">
                      <div className="label-xs">Payment Schedule</div>
                      {data!.schedule.map((sp) => (
                        <div key={sp.id} className={rowCls}>
                          <span className={dtCls}>#{sp.seq} {sp.label} · {sp.due_date ?? "—"}</span>
                          <span>{money(sp.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data!.payments.length > 0 && (
                    <div className="pt-2">
                      <div className="label-xs">Payments</div>
                      {data!.payments.map((p) => (
                        <div key={p.id} className={rowCls}>
                          <span className={dtCls}>{new Date(p.paid_at).toLocaleDateString()} · {p.method}</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!loading && e && tab === "Staff" && (
                <div className="space-y-2">
                  {data!.staff.length === 0 && <p className="text-sm text-zinc-500">No staff assigned.</p>}
                  {data!.staff.map((s) => (
                    <div key={s.id} className={rowCls}>
                      <span className="font-semibold">
                        {s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : "(unknown)"}
                      </span>
                      <span className={dtCls}>{s.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* footer */}
            <div className="flex justify-end gap-2 border-t border-zinc-200 dark:border-white/[0.08] px-5 py-3">
              <button onClick={() => setOpen(false)} className="btn-ghost px-4 py-2 text-xs">
                Close
              </button>
              <Link href={`/events/${eventId}`} className="btn-primary px-4 py-2 text-xs">
                Open Full Event →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
