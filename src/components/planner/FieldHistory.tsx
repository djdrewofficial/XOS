"use client";

/* Staff-only per-field history for the planner.
 *
 * The planner's Activity tab answers "what happened on this event?". This
 * answers the narrower question staff actually ask at the field itself: who
 * last touched THIS answer/song/section, when, and what did it say before —
 * with a one-click way to put the old value back.
 *
 * Hosts and guests never render this: the provider is only given entries when
 * role === "staff", and the audit rows are staff-only at the RLS layer too.
 */

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClockRotateLeft, faRotateLeft, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { restorePlannerValue } from "@/app/portal/plan/[eventId]/actions";
import type { AuditEntry } from "@/lib/planning";

type Ctx = {
  eventId: string;
  byQuestion: Map<string, AuditEntry[]>;
  bySection: Map<string, AuditEntry[]>;
  bySong: Map<string, AuditEntry[]>;
};

const HistoryCtx = createContext<Ctx | null>(null);

/** Wrap the planner. Pass entries=[] for non-staff to disable the feature. */
export function FieldHistoryProvider({
  eventId,
  entries,
  children,
}: {
  eventId: string;
  entries: AuditEntry[];
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(() => {
    const byQuestion = new Map<string, AuditEntry[]>();
    const bySection = new Map<string, AuditEntry[]>();
    const bySong = new Map<string, AuditEntry[]>();
    const push = (m: Map<string, AuditEntry[]>, k: string | null, e: AuditEntry) => {
      if (!k) return;
      const list = m.get(k);
      if (list) list.push(e);
      else m.set(k, [e]);
    };
    // entries arrive newest-first and we preserve that order per bucket.
    for (const e of entries) {
      push(byQuestion, e.question_id, e);
      push(bySong, e.song_id, e);
      // A question/song edit shouldn't also show up as "section" history —
      // the section line would otherwise repeat every field change beneath it.
      if (!e.question_id && !e.song_id) push(bySection, e.section_id, e);
    }
    return { eventId, byQuestion, bySection, bySong };
  }, [eventId, entries]);

  return <HistoryCtx.Provider value={value}>{children}</HistoryCtx.Provider>;
}

function useEntries(target: { questionId?: string; sectionId?: string; songId?: string }): {
  eventId: string;
  entries: AuditEntry[];
} | null {
  const ctx = useContext(HistoryCtx);
  if (!ctx) return null;
  const entries = target.questionId
    ? ctx.byQuestion.get(target.questionId)
    : target.songId
      ? ctx.bySong.get(target.songId)
      : target.sectionId
        ? ctx.bySection.get(target.sectionId)
        : undefined;
  if (!entries?.length) return null;
  return { eventId: ctx.eventId, entries };
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Last edited by Drew · 2h ago" + expandable history. Renders nothing when
    there's no history or the viewer isn't staff. */
export default function FieldHistory(target: { questionId?: string; sectionId?: string; songId?: string }) {
  const data = useEntries(target);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;
  const { eventId, entries } = data;
  const last = entries[0];

  function restore(id: string) {
    setError(null);
    start(async () => {
      const res = await restorePlannerValue(eventId, id);
      if (!res.ok) setError(res.error ?? "Restore failed.");
    });
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 transition-colors hover:text-brand dark:hover:text-brand-lighter"
        title="Staff only — change history"
      >
        <FontAwesomeIcon icon={faClockRotateLeft} className="text-[10px]" />
        <span>
          Last changed by <span className="font-medium text-zinc-500 dark:text-zinc-400">{last.actor_name ?? "someone"}</span>
          {" · "}
          <time dateTime={last.created_at} title={fullTime(last.created_at)}>{relTime(last.created_at)}</time>
        </span>
        <FontAwesomeIcon icon={faChevronDown} className={`text-[9px] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          {error && <p className="mb-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[11px]">
                <span className="mt-[3px] shrink-0 rounded-full bg-zinc-200 px-1.5 text-[9px] font-semibold uppercase text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                  {e.actor_role}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">{e.actor_name ?? "Someone"}</span>{" "}
                  <span className="text-zinc-500 dark:text-zinc-400">{e.action.toLowerCase()}</span>
                  <span className="ml-1 text-zinc-400" title={fullTime(e.created_at)}>· {relTime(e.created_at)}</span>
                  {(e.old_value || e.new_value) && (
                    <div className="mt-0.5 leading-snug">
                      {e.old_value && (
                        <span className="text-zinc-500 line-through decoration-zinc-300 dark:decoration-zinc-600">{e.old_value}</span>
                      )}
                      {e.old_value && e.new_value && <span className="mx-1 text-zinc-300">→</span>}
                      {e.new_value && <span className="text-zinc-700 dark:text-zinc-200">{e.new_value}</span>}
                    </div>
                  )}
                </div>
                {e.restorable && (
                  <button
                    type="button"
                    onClick={() => restore(e.id)}
                    disabled={pending}
                    title="Put this value back"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-50 dark:hover:text-brand-lighter"
                  >
                    <FontAwesomeIcon icon={faRotateLeft} /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
