"use client";

import { useState, type ReactNode } from "react";

export default function Tabs({
  tabs,
}: {
  tabs: { id: string; label: string; badge?: string | number; content: ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-zinc-100/80 dark:bg-black/30 p-1 backdrop-blur-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              active === t.id
                ? "bg-gradient-to-r from-brand to-brand-light text-white shadow-lg shadow-brand/50"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active === t.id ? "bg-white/25" : "bg-black/[0.07] dark:bg-white/10 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? "" : "hidden"}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
