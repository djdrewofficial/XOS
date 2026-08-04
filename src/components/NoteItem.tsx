"use client";

import { useState, useTransition } from "react";

export type NoteView = {
  id: string;
  body: string;
  created_at: string;
  author_name?: string | null;
};

/** A single event note (contract or internal) with inline edit + delete.
    The update/delete server actions are bound to (eventId, noteId) by the
    parent server component and passed in. */
export default function NoteItem({
  note,
  updateAction,
  deleteAction,
}: {
  note: NoteView;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSave(formData: FormData) {
    startTransition(async () => {
      await updateAction(formData);
      setEditing(false);
    });
  }

  function onDelete() {
    if (!window.confirm("Delete this note?")) return;
    startTransition(() => {
      void deleteAction();
    });
  }

  return (
    <li className="rounded-lg bg-black/[0.04] p-3 dark:bg-white/[0.05]">
      {editing ? (
        <form action={onSave} className="flex flex-col gap-2">
          <textarea
            name="body"
            defaultValue={note.body}
            rows={2}
            autoFocus
            className="input w-full resize-y"
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="btn-primary px-3 py-1 text-xs">
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-zinc-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
              {note.body}
            </span>
            <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
              {note.author_name ?? "unknown"} · {new Date(note.created_at).toLocaleString()}
            </div>
          </div>
          <div className="flex shrink-0 gap-2.5 pt-0.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              className="text-[11px] font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
