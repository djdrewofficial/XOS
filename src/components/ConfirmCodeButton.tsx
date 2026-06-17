"use client";

import { useState } from "react";

/* A destructive-action button that requires typing a randomly generated 5-char
   code to confirm. Wraps a server action: the trigger opens a modal showing a
   fresh code; the confirm submit (which runs the action) stays disabled until
   the typed code matches. Used for Archive / Delete on events. */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L

function genCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export default function ConfirmCodeButton({
  action,
  label,
  triggerClassName,
  title,
  description,
  confirmLabel,
  variant = "danger",
}: {
  action: () => void | Promise<void>;
  label: string;
  triggerClassName?: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "danger" | "warn";
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const matches = input.trim().toUpperCase() === code;
  const confirmColor =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-amber-600 hover:bg-amber-700";

  function openModal() {
    setCode(genCode());
    setInput("");
    setSubmitting(false);
    setOpen(true);
  }

  return (
    <>
      <button type="button" onClick={openModal} className={triggerClassName}>
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>

            <p className="mt-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Type this code to confirm:
            </p>
            <div className="mt-1 select-none rounded-lg bg-zinc-100 px-3 py-2 text-center font-mono text-2xl font-bold tracking-[0.4em] text-zinc-900 dark:bg-white/10 dark:text-white">
              {code}
            </div>
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter code"
              className="input mt-2 w-full text-center font-mono uppercase tracking-[0.3em]"
              maxLength={5}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <form action={action}>
                <button
                  type="submit"
                  disabled={!matches || submitting}
                  onClick={() => setSubmitting(true)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${confirmColor}`}
                >
                  {submitting ? "Working…" : confirmLabel}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
