"use client";

import { useState } from "react";

export default function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={className ?? "text-xs font-semibold text-brand dark:text-brand-lighter hover:underline"}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
