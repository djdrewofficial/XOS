"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* Run-of-Show generator button for the Planning/Notes hub. Generates the booth-ready
   PDF from the planner + call transcript + notes, saves it to Docs, and optionally
   emails the assigned staff. */

export default function RunOfShowButton({ eventId, configured }: { eventId: string; configured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/events/${eventId}/run-of-show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? "Generation failed.");
      } else {
        setMsg(
          `Run of show generated and saved to Documents${json.emailed ? ` · emailed ${json.emailed} staff member${json.emailed === 1 ? "" : "s"}` : ""}.`,
        );
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="card-title">Run of Show</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Builds a booth-ready run sheet from the planner timeline, the Fireflies call, and notes — CRITICAL FLAGS up top,
        then a chronological run with music cues. Saves to Documents{email ? " and emails the assigned staff" : ""}.
      </p>

      {!configured ? (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Add <code>OPENAI_API_KEY</code> in Netlify to enable this.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={generate} disabled={busy} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
            {busy ? "Generating… (up to a minute)" : "Generate Run of Show"}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-zinc-500">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} disabled={busy} />
            Email assigned staff
          </label>
        </div>
      )}

      {msg && <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
    </div>
  );
}
