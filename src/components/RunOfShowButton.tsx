"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* Run-of-Show button. Generation runs in a background function (the sync request caps
   at ~26s but OpenAI + PDF is longer), so this starts the job and polls for status. */

export default function RunOfShowButton({ eventId, configured }: { eventId: string; configured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stop() {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    setBusy(false);
  }

  async function poll(started: number) {
    try {
      const res = await fetch(`/api/events/${eventId}/run-of-show`, { cache: "no-store" });
      const { job } = await res.json();
      if (job?.status === "done") {
        setMsg(`Run of show saved to Documents${job.emailed ? ` · emailed ${job.emailed} staff member${job.emailed === 1 ? "" : "s"}` : ""}.`);
        stop();
        router.refresh();
        return;
      }
      if (job?.status === "error") {
        setErr(job.error || "Generation failed.");
        stop();
        return;
      }
    } catch {
      /* transient — keep polling */
    }
    if (Date.now() - started > 4 * 60 * 1000) {
      setErr("Still working after a few minutes — check the Documents tab shortly.");
      stop();
      return;
    }
    pollRef.current = setTimeout(() => poll(started), 3000);
  }

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
      let json: { ok?: boolean; jobId?: string; error?: string };
      try {
        json = await res.json();
      } catch {
        json = { ok: false, error: `Server error (${res.status}).` };
      }
      if (!json.ok) {
        setErr(json.error ?? "Couldn't start.");
        setBusy(false);
        return;
      }
      poll(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed.");
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
            {busy ? "Generating… (up to a minute or two)" : "Generate Run of Show"}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-zinc-500">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} disabled={busy} />
            Email assigned staff
          </label>
        </div>
      )}

      {busy && <div className="mt-2 text-xs text-zinc-400">Working in the background — this stays running even if you navigate away; it&apos;ll land in Documents.</div>}
      {msg && <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
    </div>
  );
}
