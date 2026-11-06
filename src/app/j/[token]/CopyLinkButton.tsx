"use client";

import { useState } from "react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4">
      <label className="mb-1 block text-xs font-semibold text-zinc-500" htmlFor="join-link">
        Link
      </label>
      <div className="flex gap-2">
        <input
          id="join-link"
          readOnly
          value={url}
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg bg-[#4b328e] px-3 py-2 text-xs font-semibold text-white"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">After you install the app, it can read this link from your clipboard.</p>
    </div>
  );
}
