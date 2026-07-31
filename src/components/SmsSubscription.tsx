"use client";

import { useState, useTransition } from "react";

type Result = { ok: boolean; error?: string };

export type SmsStatusProps = {
  /** Normalized E.164, or null when there's no usable mobile number. */
  phone: string | null;
  optedOut: boolean;
  source: string | null;
  reason: string | null;
  updatedAt: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  inbound_stop: "replied STOP",
  inbound_start: "replied START",
  manual: "set by staff",
  ghl_dnd: "HighLevel DND",
};

/** SMS subscription status + staff opt-out/opt-in toggle for a client's mobile
    number. Reflects the XOS opt-out list (STOP replies, staff changes). */
export default function SmsSubscription({
  clientId,
  status,
  action,
}: {
  clientId: string;
  status: SmsStatusProps;
  action: (clientId: string, optedOut: boolean) => Promise<Result>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [optedOut, setOptedOut] = useState(status.optedOut);

  function toggle(next: boolean) {
    setMsg(null);
    startTransition(async () => {
      const r = await action(clientId, next);
      if (r.ok) {
        setOptedOut(next);
        setMsg({ ok: true, text: next ? "Marked unsubscribed — SMS will be suppressed." : "Re-subscribed — SMS can send again." });
      } else {
        setMsg({ ok: false, text: r.error ?? "Something went wrong." });
      }
    });
  }

  const when = status.updatedAt ? new Date(status.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const via = status.source ? SOURCE_LABEL[status.source] ?? status.source : null;

  return (
    <div className="card max-w-2xl p-5">
      <h2 className="card-title">SMS Subscription</h2>

      {!status.phone ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No mobile number on file for this client.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className={`inline-block size-2 rounded-full ${optedOut ? "bg-red-500" : "bg-green-500"}`} />
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              {optedOut ? "Unsubscribed" : "Subscribed"}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">· {status.phone}</span>
          </div>

          {optedOut && (when || via) && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Opted out{when ? ` on ${when}` : ""}{via ? ` (${via})` : ""}. Automated texts to this number are withheld.
            </p>
          )}

          <div className="mt-4">
            {optedOut ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(false)}
                className="btn-ghost px-4 py-1.5 text-xs disabled:opacity-50"
              >
                {pending ? "Working…" : "Re-subscribe (opt in)"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(true)}
                className="btn-ghost px-4 py-1.5 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
              >
                {pending ? "Working…" : "Mark unsubscribed (opt out)"}
              </button>
            )}
          </div>

          {msg && (
            <p className={`mt-3 text-sm ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {msg.text}
            </p>
          )}

          <p className="mt-3 text-xs text-zinc-400">
            Clients who text STOP are unsubscribed automatically; START re-subscribes them. Use this only when a
            client asks you directly to change their preference.
          </p>
        </>
      )}
    </div>
  );
}
