"use client";

import { useState } from "react";
import { RECIPIENT_MODE_OPTIONS, RECIPIENT_ROLE_OPTIONS, type RecipientMode } from "@/lib/helperRecipients";

/** Template-level recipient picker for a helper email or SMS step. */
export default function HelperRecipientModeFields({
  prefix,
  initialMode = "default",
  initialRoles = [],
}: {
  /** Form field prefix: "email" or "sms". */
  prefix: string;
  initialMode?: RecipientMode | string;
  initialRoles?: string[];
}) {
  const safeMode = (RECIPIENT_MODE_OPTIONS.some((o) => o.value === initialMode)
    ? initialMode
    : "default") as RecipientMode;
  const [mode, setMode] = useState<RecipientMode>(safeMode);
  const hint = RECIPIENT_MODE_OPTIONS.find((o) => o.value === mode)?.hint;

  return (
    <div className="space-y-2">
      <select
        name={`${prefix}_recipients_mode`}
        value={mode}
        onChange={(e) => setMode(e.target.value as RecipientMode)}
        className="input w-full max-w-md"
      >
        {RECIPIENT_MODE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {mode === "roles" && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPIENT_ROLE_OPTIONS.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
            >
              <input
                type="checkbox"
                name={`${prefix}_recipients_roles`}
                value={r.value}
                defaultChecked={initialRoles.map((x) => x.toLowerCase()).includes(r.value.toLowerCase())}
                className="size-3.5 shrink-0 accent-brand-light"
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      )}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        When this helper runs on an event, staff can confirm or change the exact contacts before sending.
      </p>
    </div>
  );
}
