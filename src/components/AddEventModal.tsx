"use client";

import { useEffect, useState, type ReactNode } from "react";
import NewEventForm from "@/components/NewEventForm";
import { createEventOnboarding, loadNewEventFormData } from "@/app/(app)/events/actions";

type FormData = Awaited<ReturnType<typeof loadNewEventFormData>>;

/* "Add Event" as a modal instead of a full page. The reference data is loaded
   lazily the first time the modal opens. On successful create, the server
   action redirects to the new event, which closes the modal by navigating. */
export default function AddEventModal({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(false);

  async function openModal() {
    setOpen(true);
    if (!data && !loading) {
      setLoading(true);
      try {
        setData(await loadNewEventFormData());
      } finally {
        setLoading(false);
      }
    }
  }

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {children}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:p-6">
          <div className="my-4 w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-zinc-200 bg-white px-5 py-3.5 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Add Event</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <div className="p-5">
              {data ? (
                <NewEventForm action={createEventOnboarding} {...data} />
              ) : (
                <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
                  <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand dark:border-zinc-600 dark:border-t-brand-lighter" />
                  Loading…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
