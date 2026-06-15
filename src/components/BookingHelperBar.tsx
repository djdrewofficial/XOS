"use client";

import { useState, useTransition } from "react";
import { runBookingHelper } from "@/app/(app)/events/actions";

type Helper = {
  id: string;
  title: string;
  button_text: string;
  button_bg: string;
  button_fg: string;
  button_font_size?: number | null;
  button_font_weight?: number | null;
  visible_status_ids: string[];
  hide_if_payment_made: boolean;
  hide_if_already_ran: boolean;
  hide_if_helpers_ran: string[];
  summary: string[];
};

export default function BookingHelperBar({
  eventId,
  statusId,
  helpers,
  ranHelperIds,
  hasPayments,
}: {
  eventId: string;
  statusId: string | null;
  helpers: Helper[];
  ranHelperIds: string[];
  hasPayments: boolean;
}) {
  const [confirm, setConfirm] = useState<Helper | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = helpers.filter((h) => {
    if (h.visible_status_ids.length > 0 && (!statusId || !h.visible_status_ids.includes(statusId))) return false;
    if (h.hide_if_payment_made && hasPayments) return false;
    if (h.hide_if_already_ran && ranHelperIds.includes(h.id)) return false;
    if (h.hide_if_helpers_ran.some((id) => ranHelperIds.includes(id))) return false;
    return true;
  });

  if (visible.length === 0) return null;

  function run(h: Helper) {
    setError(null);
    startTransition(async () => {
      try {
        await runBookingHelper(eventId, h.id);
        setConfirm(null);
        setDone(h.title);
        setTimeout(() => setDone(null), 6000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong running this helper.");
      }
    });
  }

  return (
    <div className="mb-6 card p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Booking Helpers
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => setConfirm(h)}
            className="rounded px-3 py-1.5 shadow-sm transition-transform hover:scale-105"
            style={{
              backgroundColor: h.button_bg,
              color: h.button_fg,
              fontSize: `${h.button_font_size ?? 14}px`,
              fontWeight: h.button_font_weight ?? 700,
            }}
          >
            {h.button_text}
          </button>
        ))}
      </div>

      {done && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          ✓ &ldquo;{done}&rdquo; started — its actions are running.
        </div>
      )}

      {/* confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !pending && setConfirm(null)}>
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-center text-lg font-extrabold text-zinc-900 dark:text-white">{confirm.title}</h3>
            <p className="mt-1 text-center text-sm font-semibold text-zinc-600 dark:text-zinc-300">
              Confirm the following actions…
            </p>

            <ul className="mx-auto mt-4 max-w-xs space-y-1.5 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {confirm.summary.length === 0 ? (
                <li className="text-zinc-400">This helper has no configured actions.</li>
              ) : (
                confirm.summary.map((s, i) => <li key={i}>{s}</li>)
              )}
            </ul>

            {error && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirm(null)}
                className="rounded-lg bg-red-500 px-6 py-2 text-sm font-bold text-white shadow transition-all hover:brightness-110 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(confirm)}
                className="rounded-lg bg-emerald-500 px-7 py-2 text-sm font-bold text-white shadow transition-all hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Starting…" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
