import type { ReactNode } from "react";
import UrlTabLink from "@/components/UrlTabLink";

/* URL-driven tabs for the event page: the active tab lives in ?tab=, so the
   server only builds/ships the open panel's content (and only fetches that
   tab's heavy data). Tab links do NOT full-prefetch. prefetch={true} was
   rebuilding every tab (each one a full event-page render) in the background,
   which filled the browser's connections and made Save look dead until refresh.

   NOTE: this is deliberately separate from <Tabs> (the instant client toggle),
   which the helper editor needs because it lives inside a form — navigating
   would lose unsaved input. Don't merge them. */

export type UrlTab = { id: string; label: string; badge?: string | number; content: ReactNode };

export default function UrlTabs({
  tabs,
  active,
  basePath,
}: {
  tabs: UrlTab[];
  active: string;
  basePath: string;
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 backdrop-blur-sm dark:border-white/[0.07] dark:bg-black/30 md:flex-wrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const isActive = t.id === current?.id;
          return (
            <UrlTabLink
              key={t.id}
              href={`${basePath}?tab=${t.id}`}
              className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                isActive
                  ? "bg-gradient-to-r from-brand to-brand-light text-white shadow-lg shadow-brand/50"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge !== 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? "bg-white/25" : "bg-black/[0.07] dark:bg-white/10 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </UrlTabLink>
          );
        })}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
