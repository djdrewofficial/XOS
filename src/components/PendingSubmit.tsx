"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/* Submit button for a server-action form. Disabled while that form is
   submitting so a second click cannot queue another write. */
export default function PendingSubmit({
  children,
  pendingLabel = "Working…",
  className,
  disabled = false,
  title,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" title={title} disabled={disabled || pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
