"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/* Platform-wide save feedback: every server-action submit button shows
   "Saving…" while pending, then a brand-purple "✓ Saved" pulse for ~2s.
   Must be rendered inside the <form> it submits (useFormStatus). */
export default function SaveButton({
  children = "Save",
  className = "btn-primary",
  savedLabel = "Saved",
  disabled = false,
}: {
  children?: ReactNode;
  className?: string;
  savedLabel?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2200);
      return () => clearTimeout(t);
    }
  }, [pending]);

  if (pending) {
    return (
      <button disabled className={`${className} cursor-wait gap-2`}>
        <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        Saving…
      </button>
    );
  }

  if (saved) {
    return (
      <button
        type="button"
        className={`${className} pointer-events-none gap-1.5 saved-flash`}
        style={{ backgroundImage: "none", backgroundColor: "var(--color-brand, #4b328e)", color: "#fff" }}
      >
        <span className="text-base leading-none">✓</span> {savedLabel}
      </button>
    );
  }

  return (
    <button disabled={disabled} className={className}>
      {children}
    </button>
  );
}
