"use client";

import { useState } from "react";
import { copyTextToClipboard, truncatePayUrl } from "@/lib/payLink";

/** Staff control: copy the client /pay/<token> URL to text or email the client. */
export default function CopyPaymentLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!url) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]">
        <button type="button" disabled className="btn-primary w-full px-4 py-2.5 text-sm disabled:opacity-50 md:w-auto">
          Copy payment link
        </button>
        <p className="mt-1.5 text-xs text-zinc-500">No payment link on this event yet.</p>
      </div>
    );
  }

  const display = showFull ? url : truncatePayUrl(url);

  const onCopy = async () => {
    setCopyFailed(false);
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      setShowFull(true);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => void onCopy()}
          className={`btn-primary w-full px-4 py-2.5 text-sm sm:w-auto ${copied ? "ring-2 ring-emerald-400/60" : ""}`}
        >
          {copied ? "Payment link copied" : "Copy payment link"}
        </button>
        <p className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300" title={url}>
          {display}
        </p>
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="btn-ghost self-start px-3 py-2 text-xs sm:self-auto"
        >
          {showFull ? "Hide full link" : "Show full link"}
        </button>
      </div>
      {showFull && (
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 dark:border-white/15 dark:bg-white/5 dark:text-zinc-200"
          aria-label="Payment link"
        />
      )}
      {copied && (
        <p className="mt-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400" role="status">
          Payment link copied
        </p>
      )}
      {copyFailed && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          Clipboard blocked. Select the link above and copy it manually.
        </p>
      )}
      <p className="mt-1.5 text-xs text-zinc-500">
        Client pay page. Paste into a text or email.
      </p>
    </div>
  );
}
