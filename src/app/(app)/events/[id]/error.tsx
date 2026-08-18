"use client";

import Link from "next/link";

/* Graceful error boundary for the event detail route. Without this, a thrown
   server action (e.g. the delete guard refusing an event with payment history)
   renders the stark full-page "server error" screen. This shows the message
   in-app with a way to recover. */
export default function EventError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="card p-8">
        <div className="text-3xl">⚠️</div>
        <h2 className="card-title mt-2">That action couldn&apos;t complete</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {error?.message && !/server components render/i.test(error.message)
            ? error.message
            : "Something went wrong with that action. If you were deleting an event that has payment history, remove its payments first (Financials tab) or archive it instead."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={reset} className="btn-primary px-4 py-2 text-sm">
            Try again
          </button>
          <Link href="/events" className="btn-ghost px-4 py-2 text-sm">
            Back to events
          </Link>
        </div>
      </div>
    </div>
  );
}
