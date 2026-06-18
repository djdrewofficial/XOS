"use client";

import { useState, useTransition, type ReactNode } from "react";

type Result = { ok: boolean; error?: string };

/** Login management card — works for any subject (employee, client) that has an
    id, an email, and invite/reset server actions taking that id. */
export default function LoginAccess({
  subjectId,
  linked,
  email,
  invite,
  reset,
  hasLoginLabel = "Has an XOS login",
  noLoginLabel = "No login yet",
  footer,
}: {
  subjectId: string;
  linked: boolean;
  email: string | null;
  invite: (id: string) => Promise<Result>;
  reset: (id: string) => Promise<Result>;
  hasLoginLabel?: string;
  noLoginLabel?: string;
  footer?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: (id: string) => Promise<Result>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn(subjectId);
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "Something went wrong." });
    });
  }

  return (
    <div className="card max-w-2xl p-5">
      <h2 className="card-title">Login &amp; Access</h2>
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block size-2 rounded-full ${linked ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
        />
        <span className="text-zinc-600 dark:text-zinc-400">{linked ? hasLoginLabel : noLoginLabel}</span>
      </div>

      {!email && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Add an email and save before inviting.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !email}
          onClick={() => run(invite, linked ? "Invitation re-sent." : "Invitation sent.")}
          className="btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
        >
          {pending ? "Working…" : linked ? "Resend Invite" : "Send Invite"}
        </button>
        {linked && (
          <button
            type="button"
            disabled={pending || !email}
            onClick={() => run(reset, "Password reset email sent.")}
            className="btn-ghost px-4 py-1.5 text-xs disabled:opacity-50"
          >
            Reset Password
          </button>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </p>
      )}

      {footer && <div className="mt-3 text-xs text-zinc-400">{footer}</div>}
    </div>
  );
}
