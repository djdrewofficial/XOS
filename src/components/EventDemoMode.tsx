"use client";

import { useState, useTransition } from "react";
import { disableEventDemoModeAction, enableEventDemoModeAction } from "@/app/(app)/events/demoModeActions";

/** Demo Mode control for the event Client / App access area.
    Enable seeds sample planner data for prospects; disable offers clean slate
    vs keep-client-entries. Never sends email/SMS. */
export default function EventDemoMode({
  eventId,
  demoMode,
  hasRealPlanningHint = false,
}: {
  eventId: string;
  demoMode: boolean;
  /** Server already saw non-demo answers/songs; show a stronger confirm on enable. */
  hasRealPlanningHint?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);

  function enable(force: boolean) {
    start(async () => {
      setError(null);
      const result = await enableEventDemoModeAction(eventId, force);
      if (!result.ok) {
        if (result.code === "HAS_REAL_DATA") {
          setForceOpen(true);
          setError(result.error);
          return;
        }
        setError(result.error);
        return;
      }
      setForceOpen(false);
    });
  }

  function disable(mode: "clean_slate" | "keep_client") {
    start(async () => {
      setError(null);
      const result = await disableEventDemoModeAction(eventId, mode);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDisableOpen(false);
    });
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        demoMode
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
          : "border-zinc-200 bg-zinc-50/80 dark:border-white/10 dark:bg-white/[0.03]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Demo Mode</h3>
            {demoMode && (
              <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                On
              </span>
            )}
          </div>
          <p className={`mt-1 text-sm ${demoMode ? "text-amber-900 dark:text-amber-200" : "text-zinc-500"}`}>
            {demoMode
              ? "Sample timeline, songs, and answers are loaded so the prospect can explore the app. Planning % and song lists here are demo data, not real client prep."
              : "Fill this event's planner with realistic sample data so a Lead or Pending prospect can open the Xpress DJs app and explore. Turn it off before they start real planning. Does not send any invite or message."}
          </p>
        </div>
        {demoMode ? (
          <button
            type="button"
            disabled={pending}
            className="btn-ghost shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() => setDisableOpen(true)}
          >
            {pending ? "Working…" : "Turn Demo Mode off"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() => (hasRealPlanningHint ? setForceOpen(true) : enable(false))}
          >
            {pending ? "Seeding…" : "Turn Demo Mode on"}
          </button>
        )}
      </div>
      {error && !forceOpen && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {forceOpen && (
        <Modal
          title="Replace existing planning data?"
          onClose={() => {
            setForceOpen(false);
            setError(null);
          }}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This event already has real planning answers, songs, or notes. Enabling Demo Mode will replace that planner
            data with sample content. Proposals, pricing, and automated comms settings are not changed.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setForceOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              onClick={() => enable(true)}
            >
              {pending ? "Seeding…" : "Replace with demo data"}
            </button>
          </div>
        </Modal>
      )}

      {disableOpen && (
        <Modal title="Turn Demo Mode off" onClose={() => setDisableOpen(false)}>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
            Choose how to leave Demo Mode. Neither option sends email or texts.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              disabled={pending}
              className="w-full rounded-lg border border-brand/30 bg-brand/5 px-3 py-3 text-left hover:bg-brand/10 disabled:opacity-50 dark:border-brand-light/30 dark:bg-brand/10"
              onClick={() => disable("clean_slate")}
            >
              <span className="block text-sm font-semibold text-zinc-900 dark:text-white">
                Reset to a clean slate <span className="text-[10px] font-bold uppercase text-brand">Default</span>
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Removes all sample data and anything added during demo, then opens a blank planning template for real
                prep.
              </span>
            </button>
            <button
              type="button"
              disabled={pending}
              className="w-full rounded-lg border border-zinc-200 px-3 py-3 text-left hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]"
              onClick={() => disable("keep_client")}
            >
              <span className="block text-sm font-semibold text-zinc-900 dark:text-white">
                Remove sample data only
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Keeps songs, answers, and notes the client added themselves. Removes only the seeded sample rows.
              </span>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDisableOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function DemoModeBanner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 ${className}`}
      role="status"
    >
      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        Demo Mode
      </span>
      <span>
        Sample planning data is loaded for this prospect. Do not treat progress %, songs, or answers as real client prep.
      </span>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
