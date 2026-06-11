"use client";

import { useState } from "react";
import { updateStatus, deleteStatus } from "@/app/(app)/settings/statuses/actions";
import SaveButton from "@/components/SaveButton";

const GROUPS = [
  ["is_booked_group", "Booked"],
  ["is_pending_group", "Pending"],
  ["is_lost_sale_group", "Lost Sale"],
  ["is_leads_group", "Leads"],
] as const;

const COUNTS = [
  ["counts_financial", "Financials", "Counts toward financial calculations"],
  ["counts_availability", "Availability", "Blocks employees on the availability check"],
  ["counts_payroll", "Payroll", "Generates employee payroll for the event"],
] as const;

type GroupKey = (typeof GROUPS)[number][0];
type CountKey = (typeof COUNTS)[number][0];

export type Status = {
  id: string;
  name: string;
  color: string;
  text_color: string;
  sort_order: number;
  is_active: boolean;
} & Record<GroupKey, boolean> &
  Record<CountKey, boolean>;

const SWATCH =
  "h-9 w-12 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-white/10";

export default function StatusRow({ status, inUse }: { status: Status; inUse: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  const [textColor, setTextColor] = useState(status.text_color);

  const activeGroups = GROUPS.filter(([k]) => status[k]);

  return (
    <div className={`border-t border-zinc-100 first:border-t-0 dark:border-white/[0.05] ${!status.is_active ? "opacity-60" : ""}`}>
      {/* summary */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
      >
        <span className="w-7 shrink-0 text-center text-xs tabular-nums text-zinc-400">{status.sort_order}</span>
        <span className="chip shrink-0" style={{ backgroundColor: status.color, color: status.text_color }}>
          {status.name}
        </span>
        <span className="flex flex-wrap gap-1">
          {activeGroups.map(([k, l]) => (
            <span key={k} className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
              {l}
            </span>
          ))}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-zinc-400">
          {inUse > 0 && <span>{inUse} in use</span>}
          {!status.is_active && <span className="font-semibold uppercase">inactive</span>}
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </span>
      </button>

      {/* editor */}
      {open && (
        <form action={updateStatus.bind(null, status.id)} className="grid gap-4 px-4 pt-1 pb-5 md:grid-cols-2">
          <div className="flex items-end gap-3 md:col-span-2">
            <div className="flex-1">
              <label className="label-xs">Status Name</label>
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
            </div>
            <span className="chip mb-1.5" style={{ backgroundColor: color, color: textColor }}>
              {name || "Preview"}
            </span>
          </div>

          <div>
            <label className="label-xs">Background Color</label>
            <div className="flex items-center gap-2">
              <input type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} className={SWATCH} />
              <span className="text-xs uppercase text-zinc-500">{color}</span>
            </div>
          </div>
          <div>
            <label className="label-xs">Text Color</label>
            <div className="flex items-center gap-2">
              <input type="color" name="text_color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className={SWATCH} />
              <span className="text-xs uppercase text-zinc-500">{textColor}</span>
            </div>
          </div>

          <div>
            <label className="label-xs">Sort Order</label>
            <input
              type="number"
              name="sort_order"
              defaultValue={status.sort_order}
              className="input w-28 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div>
            <label className="label-xs">Semantic Group</label>
            <div className="flex flex-wrap gap-2">
              {GROUPS.map(([k, l]) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
                >
                  <input type="checkbox" name={k} defaultChecked={status[k]} className="size-4 accent-brand-light" />
                  {l}
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="label-xs">Counts Toward</label>
            <div className="flex flex-wrap gap-2">
              {COUNTS.map(([k, l, hint]) => (
                <label
                  key={k}
                  title={hint}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
                >
                  <input type="checkbox" name={k} defaultChecked={status[k]} className="size-4 accent-brand-light" />
                  {l}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between md:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="is_active" defaultChecked={status.is_active} className="size-4 accent-brand-light" />
              Active
            </label>
            <div className="flex items-center gap-4">
              {inUse === 0 ? (
                <button formAction={deleteStatus.bind(null, status.id)} className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400">
                  Delete
                </button>
              ) : (
                <span className="text-xs text-zinc-400" title="In use by events — deactivate instead">🔒 in use</span>
              )}
              <SaveButton className="btn-primary px-6 py-1.5 text-xs">Save</SaveButton>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
