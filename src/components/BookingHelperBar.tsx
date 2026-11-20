"use client";

import { useState, useTransition } from "react";
import { runBookingHelper, getHelperSmsPrompts, getHelperRecipientPreview } from "@/app/(app)/events/actions";
import type {
  HelperRecipientOverride,
  HelperSmsOverride,
  HelperSmsPrompt,
  HelperStepRecipientPreview,
} from "@/lib/bookingHelperRun";

type Helper = {
  id: string;
  title: string;
  button_text: string;
  button_bg: string;
  button_fg: string;
  button_font_size?: number | null;
  button_font_weight?: number | null;
  visible_status_ids: string[];
  hide_if_payment_made: boolean;
  hide_if_already_ran: boolean;
  hide_if_helpers_ran: string[];
  summary: string[];
  /** helper has at least one SMS action flagged "prompt to send" */
  sms_prompt?: boolean;
  /** helper has at least one client email/SMS step */
  has_client_sends?: boolean;
};

/** The operator's decision for one prompted text: send it or not, and the final wording. */
type SmsChoice = { send: boolean; body: string };

export default function BookingHelperBar({
  eventId,
  statusId,
  helpers,
  ranHelperIds,
  hasPayments,
}: {
  eventId: string;
  statusId: string | null;
  helpers: Helper[];
  ranHelperIds: string[];
  hasPayments: boolean;
}) {
  const [confirm, setConfirm] = useState<Helper | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [prompts, setPrompts] = useState<HelperSmsPrompt[] | null>(null);
  const [recipientSteps, setRecipientSteps] = useState<HelperStepRecipientPreview[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [choices, setChoices] = useState<Record<number, SmsChoice>>({});
  /** Checked client ids per step index. Missing-channel contacts stay unchecked. */
  const [checkedByStep, setCheckedByStep] = useState<Record<number, Set<string>>>({});

  const visible = helpers.filter((h) => {
    if (h.visible_status_ids.length > 0 && (!statusId || !h.visible_status_ids.includes(statusId))) return false;
    if (h.hide_if_payment_made && hasPayments) return false;
    if (h.hide_if_already_ran && ranHelperIds.includes(h.id)) return false;
    if (h.hide_if_helpers_ran.some((id) => ranHelperIds.includes(id))) return false;
    return true;
  });

  if (visible.length === 0) return null;

  function close() {
    setConfirm(null);
    setPrompts(null);
    setRecipientSteps(null);
    setChoices({});
    setCheckedByStep({});
    setLoadingPreview(false);
  }

  /* Opening the dialog loads recipient checklists (and prompted SMS bodies). */
  function open(h: Helper) {
    setError(null);
    setConfirm(h);
    setPrompts(null);
    setRecipientSteps(null);
    setChoices({});
    setCheckedByStep({});
    if (!h.sms_prompt && !h.has_client_sends) return;
    setLoadingPreview(true);
    Promise.all([
      h.sms_prompt ? getHelperSmsPrompts(eventId, h.id) : Promise.resolve([] as HelperSmsPrompt[]),
      h.has_client_sends ? getHelperRecipientPreview(eventId, h.id) : Promise.resolve([] as HelperStepRecipientPreview[]),
    ])
      .then(([rows, steps]) => {
        setPrompts(rows);
        setChoices(Object.fromEntries(rows.map((r) => [r.index, { send: r.recipients.length > 0, body: r.body }])));
        setRecipientSteps(steps);
        setCheckedByStep(
          Object.fromEntries(
            steps.map((s) => [
              s.index,
              new Set(s.candidates.filter((c) => c.canSend).map((c) => c.clientId)),
            ]),
          ),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this helper's preview."))
      .finally(() => setLoadingPreview(false));
  }

  function toggleRecipient(stepIndex: number, clientId: string, canSend: boolean) {
    if (!canSend) return;
    setCheckedByStep((prev) => {
      const next = new Set(prev[stepIndex] ?? []);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return { ...prev, [stepIndex]: next };
    });
  }

  function run(h: Helper) {
    setError(null);
    // unticked → skip that text entirely; edited → send the operator's wording
    const smsOverrides: Record<string, HelperSmsOverride> = {};
    for (const p of prompts ?? []) {
      const choice = choices[p.index] ?? { send: true, body: p.body };
      if (!choice.send || p.recipients.length === 0) smsOverrides[p.index] = { skip: true };
      else if (choice.body.trim() !== p.body.trim()) smsOverrides[p.index] = { body: choice.body };
    }

    const recipientOverrides: Record<string, HelperRecipientOverride> = {};
    for (const step of recipientSteps ?? []) {
      const checked = checkedByStep[step.index] ?? new Set();
      const sendable = step.candidates.filter((c) => c.canSend).map((c) => c.clientId);
      const selected = sendable.filter((id) => checked.has(id));
      if (selected.length === 0) {
        recipientOverrides[String(step.index)] = { skip: true };
      } else {
        // Always pass the explicit list so the engine/fan-out matches the checkboxes.
        recipientOverrides[String(step.index)] = { client_ids: selected };
      }
    }

    startTransition(async () => {
      try {
        await runBookingHelper(
          eventId,
          h.id,
          Object.keys(smsOverrides).length > 0 ? smsOverrides : undefined,
          Object.keys(recipientOverrides).length > 0 ? recipientOverrides : undefined,
        );
        close();
        setDone(h.title);
        setTimeout(() => setDone(null), 6000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong running this helper.");
      }
    });
  }

  return (
    <div className="mb-6 card p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Booking Helpers
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => open(h)}
            className="rounded px-3 py-1.5 shadow-sm transition-transform hover:scale-105"
            style={{
              backgroundColor: h.button_bg,
              color: h.button_fg,
              fontSize: `${h.button_font_size ?? 14}px`,
              fontWeight: h.button_font_weight ?? 700,
            }}
          >
            {h.button_text}
          </button>
        ))}
      </div>

      {done && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          ✓ &ldquo;{done}&rdquo; started — its actions are running.
        </div>
      )}

      {/* confirmation dialog */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && close()}
        >
          <div
            className={`max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900 ${
              confirm.sms_prompt || confirm.has_client_sends ? "max-w-lg" : "max-w-md"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-center text-lg font-extrabold text-zinc-900 dark:text-white">{confirm.title}</h3>
            <p className="mt-1 text-center text-sm font-semibold text-zinc-600 dark:text-zinc-300">
              Confirm the following actions…
            </p>

            <ul className="mx-auto mt-4 max-w-xs space-y-1.5 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {confirm.summary.length === 0 ? (
                <li className="text-zinc-400">This helper has no configured actions.</li>
              ) : (
                confirm.summary.map((s, i) => <li key={i}>{s}</li>)
              )}
            </ul>

            {loadingPreview && (
              <div className="mt-4 text-center text-sm text-zinc-500">Loading recipients…</div>
            )}

            {/* Recipient confirmation: name, email/phone, role, with missing-channel warnings */}
            {(recipientSteps ?? []).map((step) => {
              const checked = checkedByStep[step.index] ?? new Set();
              return (
                <div
                  key={`recip-${step.index}`}
                  className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                    {step.channel === "email" ? "Email recipients" : "Text recipients"}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {step.configSummary}
                    {step.templateName ? ` · ${step.templateName}` : ""}
                  </div>
                  {step.candidates.length === 0 ? (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      No contacts matched this step&apos;s recipient setting.
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {step.candidates.map((c) => (
                        <li key={c.clientId}>
                          <label
                            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                              c.canSend
                                ? "cursor-pointer border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-900"
                                : "cursor-not-allowed border-amber-200 bg-amber-50/80 opacity-90 dark:border-amber-500/30 dark:bg-amber-500/10"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4 accent-brand-light"
                              checked={c.canSend && checked.has(c.clientId)}
                              disabled={!c.canSend || pending}
                              onChange={() => toggleRecipient(step.index, c.clientId, c.canSend)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-zinc-800 dark:text-zinc-100">{c.name}</span>
                              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                {step.channel === "email"
                                  ? c.email || "No email"
                                  : c.phone || "No phone"}
                                {c.role ? ` · ${c.role}` : ""}
                              </span>
                              {c.warning && (
                                <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-300">
                                  {c.warning}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {/* prompted texts: edit the wording, or untick so nothing is sent */}
            {(prompts ?? []).map((p) => {
              const choice = choices[p.index] ?? { send: true, body: p.body };
              const noRecipient = p.recipients.length === 0;
              return (
                <div
                  key={p.index}
                  className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-100">
                    <input
                      type="checkbox"
                      checked={choice.send && !noRecipient}
                      disabled={noRecipient || pending}
                      onChange={(ev) => setChoices((s) => ({ ...s, [p.index]: { ...choice, send: ev.target.checked } }))}
                      className="size-4 accent-brand-light"
                    />
                    Send this text
                  </label>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {p.label}
                    {p.template ? ` · ${p.template}` : ""}
                  </div>

                  {noRecipient ? (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      No phone number on file — nothing will be texted.
                    </div>
                  ) : (
                    <>
                      <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {p.recipients.map((r) => (r.name ? `${r.name} (${r.phone})` : r.phone)).join(", ")}
                      </div>
                      <textarea
                        rows={5}
                        value={choice.body}
                        disabled={!choice.send || pending}
                        onChange={(ev) => setChoices((s) => ({ ...s, [p.index]: { ...choice, body: ev.target.value } }))}
                        className="input mt-2 w-full text-sm disabled:opacity-50"
                      />
                      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
                        <span>Edits apply to this send only — the template is untouched.</span>
                        <span>{choice.body.trim().length} chars</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {error && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={close}
                className="rounded-lg bg-red-500 px-6 py-2 text-sm font-bold text-white shadow transition-all hover:brightness-110 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || loadingPreview}
                onClick={() => run(confirm)}
                className="rounded-lg bg-emerald-500 px-7 py-2 text-sm font-bold text-white shadow transition-all hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Starting…" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
