"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  approveSuggestion,
  dismissSuggestion,
  attachMeetingToEvent,
  unlinkMeeting,
  syncFireflies,
} from "@/app/(app)/events/[id]/fireflies-actions";

export type FFSuggestion = {
  id: string;
  text: string;
  assignee_name: string | null;
  suggested_employee_name: string | null;
  timestamp_label: string | null;
  status: "suggested" | "approved" | "dismissed";
  task_id: string | null;
};
export type FFMeeting = {
  id: string;
  title: string | null;
  date: string | null;
  duration_min: number | null;
  summary_overview: string | null;
  keywords: string[];
  meeting_link: string | null;
  audio_url: string | null;
  transcript_text: string | null;
  matched_by: string | null;
  summary_status: string | null;
  suggestions: FFSuggestion[];
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function EventFireflies({
  eventId,
  meetings,
  unlinked,
  canEdit,
  configured,
}: {
  eventId: string;
  meetings: FFMeeting[];
  unlinked: FFMeeting[];
  canEdit: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function doSync() {
    setBusy(true);
    setMsg(null);
    start(async () => {
      const res = await syncFireflies(eventId);
      setMsg(res.error ? res.error : `Imported ${res.imported} recent meeting${res.imported === 1 ? "" : "s"}.`);
      setBusy(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          Call notes &amp; transcripts from Fireflies, matched to this event. Approve action items to turn them into tasks.
        </p>
        {canEdit && (
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs text-zinc-500">{msg}</span>}
            <button onClick={doSync} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
              {busy ? "Syncing…" : "Sync from Fireflies"}
            </button>
          </div>
        )}
      </div>

      {!configured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Fireflies isn&apos;t connected yet. Add <code>FIREFLIES_API_KEY</code> in Netlify, then use Sync.
        </div>
      )}

      {meetings.length === 0 && (
        <div className="card p-8 text-center text-sm text-zinc-500">
          No Fireflies calls linked to this event yet.{" "}
          {unlinked.length === 0 && canEdit && "Use Sync to pull recent meetings — they match by the client's email."}
        </div>
      )}

      {meetings.map((m) => (
        <MeetingCard key={m.id} eventId={eventId} meeting={m} canEdit={canEdit} onAct={start} onRefresh={() => router.refresh()} />
      ))}

      {unlinked.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
            Other calls for this client — attach if they belong to this event
          </div>
          <div className="space-y-2">
            {unlinked.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-white/5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.title || "Untitled call"}</div>
                  <div className="text-xs text-zinc-400">{fmtDate(m.date)}</div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => start(async () => { await attachMeetingToEvent(eventId, m.id); router.refresh(); })}
                    className="btn-ghost shrink-0 px-3 py-1 text-xs"
                  >
                    Attach
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingCard({
  eventId,
  meeting: m,
  canEdit,
  onAct,
  onRefresh,
}: {
  eventId: string;
  meeting: FFMeeting;
  canEdit: boolean;
  onAct: (cb: () => void) => void;
  onRefresh: () => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const pending = m.suggestions.filter((s) => s.status === "suggested");
  const decided = m.suggestions.filter((s) => s.status !== "suggested");

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-100 p-4 dark:border-white/5">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{m.title || "Untitled call"}</div>
          <div className="text-xs text-zinc-400">
            {fmtDate(m.date)}
            {m.duration_min ? ` · ${Math.round(m.duration_min)} min` : ""}
            {m.matched_by === "manual" ? " · manually linked" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {m.meeting_link && <a href={m.meeting_link} target="_blank" rel="noreferrer" className="text-brand hover:underline">Meeting</a>}
          {m.audio_url && <a href={m.audio_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">Audio</a>}
          {canEdit && (
            <button onClick={() => onAct(() => { void unlinkMeeting(eventId, m.id).then(onRefresh); })} className="text-zinc-400 hover:text-red-500">
              Unlink
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {!m.summary_overview && !m.transcript_text && (
          <p className="text-sm text-zinc-400">
            {m.summary_status === "skipped"
              ? "Fireflies skipped this meeting (silent or too short), so there's no summary or transcript."
              : "No summary or transcript available for this call yet."}
          </p>
        )}
        {m.summary_overview && <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{m.summary_overview}</p>}

        {m.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {m.keywords.map((k) => (
              <span key={k} className="rounded bg-zinc-100 px-1.5 py-px text-[11px] text-zinc-500 dark:bg-zinc-800">{k}</span>
            ))}
          </div>
        )}

        {/* Suggested tasks */}
        {(pending.length > 0 || decided.length > 0) && (
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              Suggested tasks {pending.length > 0 && <span className="text-brand">({pending.length} to review)</span>}
            </div>
            <div className="space-y-2">
              {pending.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-2.5 dark:border-white/10">
                  <div className="min-w-0">
                    <div className="text-sm">{s.text}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {s.suggested_employee_name ? `→ ${s.suggested_employee_name}` : s.assignee_name ? `${s.assignee_name} (not staff)` : "unassigned"}
                      {s.timestamp_label ? ` · ${s.timestamp_label}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => onAct(() => { void approveSuggestion(eventId, s.id).then(onRefresh); })}
                        className="btn-primary px-2.5 py-1 text-xs"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => onAct(() => { void dismissSuggestion(eventId, s.id).then(onRefresh); })}
                        className="btn-ghost px-2.5 py-1 text-xs"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {decided.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-1 text-xs">
                  <span className="min-w-0 truncate text-zinc-400">
                    {s.status === "approved" ? "✓ " : "✕ "}
                    <span className={s.status === "dismissed" ? "line-through" : ""}>{s.text}</span>
                  </span>
                  {s.status === "approved" && s.task_id && (
                    <Link href={`/tasks?task=${s.task_id}`} className="shrink-0 text-brand hover:underline">
                      View task
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {m.transcript_text && (
          <div>
            <button onClick={() => setShowTranscript((v) => !v)} className="text-xs font-semibold text-brand hover:underline">
              {showTranscript ? "Hide transcript" : "Show full transcript"}
            </button>
            {showTranscript && (
              <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-white/[0.03] dark:text-zinc-300">
                {m.transcript_text}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
