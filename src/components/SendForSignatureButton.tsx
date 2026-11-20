"use client";

import { useEffect, useState, useTransition } from "react";
import { getDocumentSendContacts, sendForSignature } from "@/app/(app)/documents/actions";
import type { EventContact } from "@/lib/helperRecipients";
import { contactLabel } from "@/lib/helperRecipients";

/** Documents page: pick who receives the agreement email before sending. */
export default function SendForSignatureButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<EventContact[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    getDocumentSendContacts(documentId)
      .then((rows) => {
        setContacts(rows);
        // Default: primary with email, else every contact that has email.
        const withEmail = rows.filter((c) => (c.email ?? "").trim());
        const primary = withEmail.find((c) => c.isPrimary);
        setChecked(new Set((primary ? [primary] : withEmail).map((c) => c.clientId)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load contacts."));
  }, [open, documentId]);

  function toggle(id: string, canSend: boolean) {
    if (!canSend) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function send() {
    setError(null);
    const ids = [...checked];
    if (ids.length === 0) {
      setError("Pick at least one contact with an email address.");
      return;
    }
    startTransition(async () => {
      try {
        const sent = await sendForSignature(documentId, ids);
        setOpen(false);
        setDone(sent.to);
        setTimeout(() => setDone(null), 6000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary px-4 py-2 text-xs"
      >
        ✉ Send To Client For Signature
      </button>
      {done && (
        <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Sent to {done}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold text-zinc-900 dark:text-white">Send for signature</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Choose who receives the Booking Agreement email. The signer of record is whoever opens the link and signs
              (contract holder on the event is unchanged).
            </p>

            {!contacts && !error && (
              <div className="mt-4 text-sm text-zinc-500">Loading contacts…</div>
            )}

            {contacts && (
              <ul className="mt-4 space-y-2">
                {contacts.map((c) => {
                  const canSend = Boolean((c.email ?? "").trim());
                  return (
                    <li key={c.clientId}>
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                          canSend
                            ? "cursor-pointer border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.03]"
                            : "cursor-not-allowed border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-brand-light"
                          checked={canSend && checked.has(c.clientId)}
                          disabled={!canSend || pending}
                          onChange={() => toggle(c.clientId, canSend)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-zinc-800 dark:text-zinc-100">
                            {contactLabel(c)}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {c.email || "No email on file"}
                          </span>
                          {!canSend && (
                            <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-300">
                              No email on file — cannot receive this send.
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-bold text-zinc-800 dark:bg-white/10 dark:text-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !contacts}
                onClick={send}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
