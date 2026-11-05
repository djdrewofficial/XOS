"use client";

import { useState, useTransition } from "react";
import { PLANNING_NOTE_MAX } from "@/lib/planningNotes";
import { saveDoNotPlayNotes, saveSectionClientNotes, saveSectionStaffNotes } from "@/app/portal/plan/[eventId]/actions";

/** Couple notes and, for staff, the internal note on one planning moment.
    Saves on blur, same as a song note. Staff-only notes are not rendered unless
    `showStaffNotes` is set — callers must leave that false for couples and guests. */
export default function SectionMomentNotes({
  eventId,
  sectionId,
  notes,
  staffNotes,
  showNotes,
  canEditNotes,
  showStaffNotes,
}: {
  eventId: string;
  sectionId: string;
  notes: string | null;
  staffNotes: string | null;
  showNotes: boolean;
  canEditNotes: boolean;
  showStaffNotes: boolean;
}) {
  if (!showNotes && !showStaffNotes) return null;
  return (
    <div className="mb-5 space-y-3">
      {showNotes && (
        <NoteField
          label="Notes"
          hint="The couple, their guests with access to this moment, and staff can see this."
          value={notes}
          canEdit={canEditNotes}
          onSave={(draft) => saveSectionClientNotes(eventId, sectionId, draft)}
        />
      )}
      {showStaffNotes && (
        <NoteField
          label="Staff only notes"
          hint="Only staff can see this."
          value={staffNotes}
          canEdit={canEditNotes}
          staff
          onSave={(draft) => saveSectionStaffNotes(eventId, sectionId, draft)}
        />
      )}
    </div>
  );
}

/** Compact list for the staff event page. Every row is staff-editable. */
export function EventSectionNotes({
  eventId,
  sections,
  canEdit,
}: {
  eventId: string;
  sections: { id: string; title: string; notes: string | null; staffNotes: string | null }[];
  canEdit: boolean;
}) {
  const visible = canEdit ? sections : sections.filter((s) => s.notes || s.staffNotes);
  if (!visible.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {visible.map((section) => (
        <div key={section.id} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
          <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{section.title}</h3>
          <SectionMomentNotes
            eventId={eventId}
            sectionId={section.id}
            notes={section.notes}
            staffNotes={section.staffNotes}
            showNotes
            canEditNotes={canEdit}
            showStaffNotes
          />
        </div>
      ))}
    </div>
  );
}

/** Free text of artists, genres, and styles to avoid, shown beside the do-not-play songs. */
export function DoNotPlayPanel({
  eventId,
  text,
  songs,
  canEdit,
}: {
  eventId: string;
  text: string | null;
  songs: { id: string; title: string; artist: string | null }[];
  canEdit: boolean;
}) {
  return (
    <div className="card p-5">
      <h2 className="card-title">Do not play</h2>
      <p className="mb-3 text-xs text-zinc-500">Songs to skip, plus anything else the couple wants avoided.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Songs</h3>
          {songs.length === 0 ? (
            <p className="text-sm text-zinc-500">No songs on the do-not-play list.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {songs.map((song) => (
                <li key={song.id} className="text-zinc-800 dark:text-zinc-100">
                  {song.title}
                  {song.artist && <span className="text-zinc-400"> — {song.artist}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DoNotPlayText eventId={eventId} text={text} canEdit={canEdit} />
      </div>
    </div>
  );
}

/** The same field, inline above a Don't Play section's song list in the planner. */
export function DoNotPlayText({
  eventId,
  text,
  canEdit,
}: {
  eventId: string;
  text: string | null;
  canEdit: boolean;
}) {
  return (
    <NoteField
      label="Also avoid"
      hint="Artists, genres, or styles — for example, no reggaeton before 10pm."
      value={text}
      canEdit={canEdit}
      onSave={(draft) => saveDoNotPlayNotes(eventId, draft)}
    />
  );
}

function NoteField({
  label,
  hint,
  value,
  canEdit,
  staff,
  onSave,
}: {
  label: string;
  hint: string;
  value: string | null;
  canEdit: boolean;
  staff?: boolean;
  onSave: (draft: string) => Promise<{ ok: boolean; error?: string } | void>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stored = value ?? "";

  if (!canEdit) {
    if (!stored) return null;
    return (
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{stored}</p>
      </div>
    );
  }

  return (
    <label className="block">
      <span className={`text-[11px] font-bold uppercase tracking-wider ${staff ? "text-amber-700 dark:text-amber-300" : "text-brand dark:text-brand-lighter"}`}>
        {label}
      </span>
      <textarea
        value={draft}
        maxLength={PLANNING_NOTE_MAX}
        rows={2}
        placeholder={staff ? "Internal note for the team…" : "Details about this moment…"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() === stored.trim()) return;
          setErr(null);
          start(async () => {
            try {
              const res = await onSave(draft);
              if (res && res.ok === false) setErr(res.error || "Could not save");
            } catch {
              setErr("Could not save");
            }
          });
        }}
        className={`input mt-1 min-h-[52px] w-full text-sm ${staff ? "border-amber-300/80 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-400/5" : ""}`}
      />
      <span className="mt-1 block text-[11px] text-zinc-400">
        {pending ? "Saving…" : hint}
      </span>
      {err && <span className="mt-0.5 block text-[11px] text-red-500">{err}</span>}
    </label>
  );
}
