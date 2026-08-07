"use client";

import { useState } from "react";
import { getProposalShortLink } from "@/app/(app)/events/actions";

/* Staff button: mint (or reuse) the event's short proposal link and copy it. */
export default function CopyProposalLink({ eventId }: { eventId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyText = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the URL is shown so it can be copied manually */
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    const res = await getProposalShortLink(eventId);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setUrl(res.url);
    await copyText(res.url);
  };

  if (!url) {
    return (
      <div className="space-y-1.5">
        <button type="button" onClick={generate} disabled={busy} className="btn-primary px-4 py-2 text-xs disabled:opacity-60">
          {busy ? "Generating…" : "Copy proposal link"}
        </button>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-64 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 dark:border-white/15 dark:bg-white/5 dark:text-zinc-200"
      />
      <button type="button" onClick={() => copyText(url)} className={`btn-ghost px-3 py-2 text-xs ${copied ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand underline dark:text-brand-lighter">
        Open ↗
      </a>
    </div>
  );
}
