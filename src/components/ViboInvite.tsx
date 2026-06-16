"use client";

import { useState } from "react";

/* Lets the client text a partner/planner an invite to join the Vibo event,
   sent through XOS's own SMS. */

export default function ViboInvite({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-800 dark:text-white";

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        ✓ Invite sent{name ? ` to ${name}` : ""}!
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:border-brand hover:text-brand dark:border-white/15 dark:text-zinc-300"
      >
        Invite your partner or planner →
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <p className="text-xs text-zinc-500">We&apos;ll text them a link to join your event in Vibo.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" className={input} />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Their cell number" type="tel" className={input} />
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={working || phone.trim().length < 7}
          onClick={async () => {
            setWorking(true);
            setError(null);
            try {
              const res = await fetch("/api/vibo/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name, phone }),
              });
              if (!res.ok) throw new Error("Couldn't send — double-check the number and try again.");
              setSent(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.");
            } finally {
              setWorking(false);
            }
          }}
          className="flex-1 rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white shadow disabled:opacity-50"
        >
          {working ? "Sending…" : "Send invite"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
