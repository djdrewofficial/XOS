"use client";

import { useState, useTransition } from "react";

/* "Delete my data" control on the client detail page. Erases the client's PII and
   removes their portal login (server action anonymizeClient); events and payment
   records are kept but anonymized. Two-step confirm since it's irreversible. */
export default function AnonymizeClient({
  clientId,
  anonymizedAt,
  action,
}: {
  clientId: string;
  anonymizedAt: string | null;
  action: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (anonymizedAt) {
    return (
      <div className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="mb-1 text-sm font-bold text-zinc-800 dark:text-zinc-200">Data &amp; privacy</h2>
        This client&apos;s personal data was erased on{" "}
        <strong>{new Date(anonymizedAt).toLocaleDateString()}</strong>. Their events and payment
        records are retained in anonymized form.
      </div>
    );
  }

  const onClick = () => {
    const ok = window.confirm(
      "Erase this client's personal information (name, email, phone, address, notes) and remove their portal login?\n\n" +
        "Their events and payment history stay, but attributed to a deleted client. This cannot be undone.",
    );
    if (!ok) return;
    start(async () => {
      setMsg(null);
      const res = await action(clientId);
      setMsg(res.ok ? "Personal data erased." : res.error ?? "Could not erase data.");
    });
  };

  return (
    <div className="card border-red-300/50 p-4 dark:border-red-500/30">
      <h2 className="mb-1 text-sm font-bold text-red-700 dark:text-red-400">Data &amp; privacy</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Honor a &ldquo;delete my data&rdquo; request. Erases this client&apos;s personal info and
        portal login; their events and payment records are kept but anonymized. Irreversible.
      </p>
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
      >
        {pending ? "Erasing…" : "Erase personal data"}
      </button>
      {msg && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{msg}</p>}
    </div>
  );
}
