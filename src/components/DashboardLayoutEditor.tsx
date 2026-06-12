"use client";

import { useState } from "react";
import { WIDGETS, WIDGET_BY_ID, type LayoutItem, type WidgetSize } from "@/lib/dashboardWidgets";
import SaveButton from "@/components/SaveButton";

/* Per-role dashboard builder: ordered widget list with size, reorder, remove,
   and an add-widget picker. Submits the layout as JSON to the server action. */
export default function DashboardLayoutEditor({
  initial,
  action,
}: {
  initial: LayoutItem[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [items, setItems] = useState<LayoutItem[]>(initial);

  const available = WIDGETS.filter((w) => !items.some((i) => i.id === w.id));

  function move(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setSize(index: number, size: WidgetSize) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, size } : it)));
  }

  function remove(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function add(id: string) {
    const def = WIDGET_BY_ID.get(id);
    if (!def || items.some((i) => i.id === id)) return;
    setItems((prev) => [...prev, { id, size: def.defaultSize }]);
  }

  return (
    <form action={action}>
      <input type="hidden" name="widgets" value={JSON.stringify(items)} />

      <div className="card overflow-hidden">
        {items.map((item, i) => {
          const def = WIDGET_BY_ID.get(item.id);
          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 border-t border-zinc-100 px-4 py-3 first:border-t-0 dark:border-white/[0.05]"
            >
              <span className="w-6 text-center text-xs tabular-nums text-zinc-400">{i + 1}</span>
              <div className="min-w-44 flex-1">
                <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{def?.name ?? item.id}</div>
                {def?.description && <div className="text-xs text-zinc-500">{def.description}</div>}
              </div>
              <select
                value={item.size}
                onChange={(e) => setSize(i, e.target.value as WidgetSize)}
                className="input w-32 py-1.5 text-xs"
              >
                <option value="full">Full width</option>
                <option value="half">Half width</option>
              </select>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-ghost px-2.5 py-1 text-xs disabled:opacity-30" aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="btn-ghost px-2.5 py-1 text-xs disabled:opacity-30" aria-label="Move down">
                  ↓
                </button>
                <button type="button" onClick={() => remove(i)} className="ml-1 text-xs font-semibold text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            No widgets — this role sees an empty dashboard. Add widgets below.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Add widget:</span>
          {available.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => add(w.id)}
              title={w.description}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              + {w.name}
            </button>
          ))}
          {available.length === 0 && <span className="text-xs text-zinc-400">all widgets placed</span>}
        </div>
        <SaveButton>Save Layout</SaveButton>
      </div>
    </form>
  );
}
