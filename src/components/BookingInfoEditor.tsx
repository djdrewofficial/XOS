"use client";

import { useState, useTransition } from "react";

type Option = { id: string; name: string };
type Status = { id: string; name: string; color: string; text_color: string };

export default function BookingInfoEditor({
  current,
  statuses,
  sources,
  salespeople,
  save,
}: {
  current: {
    statusId: string | null;
    sourceId: string | null;
    sourceName: string | null;
    salespersonId: string | null;
    salespersonName: string | null;
  };
  statuses: Status[];
  sources: Option[];
  salespeople: Option[];
  save: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentStatus = statuses.find((s) => s.id === current.statusId) ?? null;

  if (!editing) {
    return (
      <div>
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Event Status</dt>
            <dd>
              {currentStatus ? (
                <span
                  className="status-chip"
                  style={{ backgroundColor: currentStatus.color, color: currentStatus.text_color }}
                >
                  {currentStatus.name}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Inquiry Source</dt>
            <dd>{current.sourceName ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Salesperson</dt>
            <dd>{current.salespersonName ?? "—"}</dd>
          </div>
        </dl>
        <button onClick={() => setEditing(true)} className="btn-ghost mt-4 px-4 py-1.5 text-xs">
          Edit
        </button>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await save(fd);
          setEditing(false);
        })
      }
      className="space-y-3"
    >
      <div>
        <label className="label-xs">Event Status</label>
        <select name="status_id" defaultValue={current.statusId ?? ""} className="input w-full">
          <option value="">—</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-xs">Inquiry Source</label>
        <select name="inquiry_source_id" defaultValue={current.sourceId ?? ""} className="input w-full">
          <option value="">—</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-xs">Salesperson</label>
        <select name="salesperson_id" defaultValue={current.salespersonId ?? ""} className="input w-full">
          <option value="">—</option>
          {salespeople.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary px-5 py-2 text-xs">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-4 py-2 text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
