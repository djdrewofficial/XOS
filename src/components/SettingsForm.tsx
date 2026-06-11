import type { ReactNode } from "react";

/* DJEP-style settings layout: brand-gradient section header bars + label-left rows.
   Shared by the booking-helper and email-template editors. */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold tracking-wide text-white">
        {title.toUpperCase()}
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-white/[0.05]">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3.5 md:grid-cols-[280px_1fr] md:items-center">
      <div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="bg-zinc-100 px-4 py-2 text-center text-xs text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-400">
      {children}
    </div>
  );
}

export function CheckBoxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-300 bg-zinc-50 px-3.5 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-brand-light" />
      {label}
    </label>
  );
}

/** A horizontal set of checkboxes that all submit under the same name. */
export function CheckGroup({
  name,
  options,
  selected,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  const set = new Set(selected);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
        >
          <input type="checkbox" name={name} value={o.value} defaultChecked={set.has(o.value)} className="size-4 accent-brand-light" />
          {o.label}
        </label>
      ))}
    </div>
  );
}
