"use client";

import { useState, useTransition } from "react";

type Result = { ok: boolean; error?: string };

/** "Invite to XOS" action button for an event's client card. One button that
    onboards (create password) or re-invites/reset — the server figures out which;
    the label reflects whether they already have a login. */
export default function InviteToXosButton({
  eventId,
  clientId,
  hasLogin,
  action,
}: {
  eventId: string;
  clientId: string;
  hasLogin: boolean;
  action: (eventId: string, clientId: string) => Promise<Result>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const r = await action(eventId, clientId);
      setMsg(
        r.ok
          ? { ok: true, text: hasLogin ? "Reset link sent" : "Invite sent" }
          : { ok: false, text: r.error ?? "Failed" },
      );
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter"
        title={hasLogin ? "Send a set/reset-password link" : "Create a portal login and send a set-password link"}
      >
        {pending ? "Sending…" : hasLogin ? "Resend / Reset" : "Invite to XOS"}
      </button>
      {msg && (
        <span className={`text-[11px] ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
