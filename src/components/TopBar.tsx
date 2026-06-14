"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import NotificationBell from "@/components/NotificationBell";
import { useMobileNav } from "@/components/MobileNav";
import {
  faGauge,
  faCalendarDays,
  faCalendarPlus,
  faMagnifyingGlass,
  faArrowLeft,
  faBars,
} from "@fortawesome/free-solid-svg-icons";

/* Sticky app header: global search on the left, quick-nav icons (same icons
   as the sidebar) with hover tooltips on the right. */

const QUICK_NAV: { href: string; label: string; icon: IconDefinition }[] = [
  { href: "/", label: "Dashboard", icon: faGauge },
  { href: "/events", label: "Events List", icon: faCalendarDays },
  { href: "/events/new", label: "Add Event", icon: faCalendarPlus },
];

type SearchResult = { type: string; label: string; sublabel?: string; href: string };

const TYPE_COLORS: Record<string, string> = {
  Page: "bg-brand/10 text-brand dark:bg-brand-light/15 dark:text-brand-lighter",
  Client: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Event: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Venue: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Vendor: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  Employee: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  Package: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
};

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const { setOpen: setNavOpen } = useMobileNav();
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // only offer Back once there's somewhere to go (and avoid SSR/window mismatch)
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, [pathname]);

  // debounced search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
        setOpen(true);
        setHighlight(0);
      } catch {
        /* aborted or offline — keep previous results */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(r: SearchResult) {
    setOpen(false);
    setQ("");
    router.push(r.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/events") return pathname === "/events" || /^\/events\/(?!new)/.test(pathname);
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white/80 px-3 backdrop-blur-xl dark:border-white/[0.06] dark:bg-black/50 sm:gap-4 sm:px-5">
      {/* hamburger — opens the nav drawer on mobile (sidebar is always-on at md+) */}
      <button
        type="button"
        onClick={() => setNavOpen(true)}
        aria-label="Open menu"
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-black/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] md:hidden"
      >
        <FontAwesomeIcon icon={faBars} />
      </button>
      {/* back — one click to wherever you came from (event → client → back) */}
      {canGoBack && (
        <button
          type="button"
          onClick={() => router.back()}
          title="Back to previous page"
          className="-ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-brand dark:hover:bg-white/[0.08] dark:hover:text-brand-lighter sm:flex"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
      )}
      {/* global search */}
      <div ref={boxRef} className="relative w-full max-w-md">
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search anything — clients, events, settings…"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-brand dark:border-zinc-600 dark:border-t-brand-lighter" />
        )}

        {open && (
          <div className="absolute left-0 right-0 top-full mt-1.5 max-h-[28rem] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900">
            {results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">No matches for &ldquo;{q}&rdquo;</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.type}-${r.href}-${i}`}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => go(r)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm ${
                    i === highlight ? "bg-brand/[0.07] dark:bg-brand-light/10" : ""
                  }`}
                >
                  <span
                    className={`w-[4.6rem] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide ${
                      TYPE_COLORS[r.type] ?? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    {r.type}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-800 dark:text-zinc-100">{r.label}</span>
                    {r.sublabel && (
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{r.sublabel}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* notifications + quick-nav icons with tooltips */}
      <nav className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-white/10" />
        {QUICK_NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={`group relative hidden size-9 items-center justify-center rounded-lg transition-all sm:flex ${
                active
                  ? "bg-gradient-to-r from-brand to-brand-light text-white shadow-lg shadow-brand/40"
                  : "text-zinc-500 hover:bg-black/[0.05] hover:text-brand dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-brand-lighter"
              }`}
            >
              <FontAwesomeIcon icon={item.icon} className="text-[15px]" />
              {/* tooltip */}
              <span className="pointer-events-none absolute top-full mt-2 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white shadow-lg group-hover:block dark:bg-white dark:text-zinc-900">
                {item.label}
                <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-zinc-900 dark:bg-white" />
              </span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
