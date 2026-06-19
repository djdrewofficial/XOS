"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* Searchable typeahead for picking a Client, Vendor, or Venue — these lists
   grow large, so a plain <select> becomes unusable. Drops a hidden input with
   the given `name`, so it's a drop-in inside any existing server-action form
   (no action changes needed). Searches the table directly, debounced.

   Edit forms: pass `defaultValue` (id) + `defaultLabel` to pre-fill without an
   extra fetch; if only `defaultValue` is given, the label is resolved on mount. */

type Row = Record<string, unknown> & { id: string };
type Kind = "client" | "vendor" | "venue";

const KINDS: Record<
  Kind,
  {
    table: string;
    select: string;
    search: string[];
    order: string;
    placeholder: string;
    label: (r: Row) => string;
    sub: (r: Row) => string;
  }
> = {
  client: {
    table: "clients",
    select: "id, first_name, last_name, email, cell_phone",
    search: ["first_name", "last_name", "email"],
    order: "first_name",
    placeholder: "Search clients…",
    label: (r) => `${(r.first_name as string) ?? ""} ${(r.last_name as string) ?? ""}`.trim(),
    sub: (r) => (r.email as string) ?? (r.cell_phone as string) ?? "",
  },
  vendor: {
    table: "vendors",
    select: "id, company_name, category",
    search: ["company_name"],
    order: "company_name",
    placeholder: "Search vendors…",
    label: (r) => (r.company_name as string) ?? "",
    sub: (r) => (r.category as string) ?? "",
  },
  venue: {
    table: "venues",
    select: "id, name, city, state",
    search: ["name", "city"],
    order: "name",
    placeholder: "Search venues…",
    label: (r) => (r.name as string) ?? "",
    sub: (r) => [r.city as string, r.state as string].filter(Boolean).join(", "),
  },
};

export default function EntityPicker({
  kind,
  name,
  defaultValue = "",
  defaultLabel,
  excludeIds = [],
  required = false,
  compact = false,
  placeholder,
}: {
  kind: Kind;
  name: string;
  defaultValue?: string;
  defaultLabel?: string;
  excludeIds?: string[];
  required?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const cfg = KINDS[kind];
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Row[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(defaultValue);
  const [selectedLabel, setSelectedLabel] = useState(defaultLabel ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // resolve a pre-selected id's label on mount when one wasn't supplied
  useEffect(() => {
    if (!defaultValue || defaultLabel) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from(cfg.table).select(cfg.select).eq("id", defaultValue).maybeSingle();
      if (data) setSelectedLabel(cfg.label(data as unknown as Row));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced search
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() || selectedId) {
      setMatches([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const q = query.trim().replace(/[%,()]/g, "");
      const branches = cfg.search.map((col) => `${col}.ilike.%${q}%`);
      // Full-name search ("Laura Smith") across first_name + last_name, either order.
      const parts = q.split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && cfg.search.includes("first_name") && cfg.search.includes("last_name")) {
        const a = parts[0];
        const b = parts.slice(1).join(" ");
        branches.push(`and(first_name.ilike.%${a}%,last_name.ilike.%${b}%)`);
        branches.push(`and(first_name.ilike.%${b}%,last_name.ilike.%${a}%)`);
      }
      const { data } = await supabase
        .from(cfg.table)
        .select(cfg.select)
        .or(branches.join(","))
        .order(cfg.order)
        .limit(8);
      const rows = ((data as unknown as Row[]) ?? []).filter((r) => !excludeIds.includes(r.id));
      setMatches(rows);
      setSearching(false);
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedId]);

  // close the results on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pad = compact ? "py-1.5" : "py-2.5";

  function choose(r: Row) {
    setSelectedId(r.id);
    setSelectedLabel(cfg.label(r));
    setQuery("");
    setMatches([]);
    setOpen(false);
  }

  function clear() {
    setSelectedId("");
    setSelectedLabel("");
    setQuery("");
  }

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name={name} value={selectedId} />

      {selectedId ? (
        <div className={`flex items-center justify-between gap-2 rounded-lg border border-brand-light/40 bg-brand/15 px-3 ${compact ? "py-1.5" : "py-2"}`}>
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
            {selectedLabel || "Selected"}
          </span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            change
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            required={required}
            placeholder={placeholder ?? cfg.placeholder}
            autoComplete="off"
            className="input w-full"
          />
          {open && query.trim() && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-300 bg-white/98 shadow-lg dark:border-white/10 dark:bg-zinc-950/98">
              {searching && <div className={`px-3 ${pad} text-xs text-zinc-500`}>Searching…</div>}
              {!searching &&
                matches.map((r) => {
                  const sub = cfg.sub(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => choose(r)}
                      className={`flex w-full items-center justify-between gap-2 px-3 text-left text-sm transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.07] ${pad}`}
                    >
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{cfg.label(r)}</span>
                      {sub && <span className="shrink-0 text-xs text-zinc-500">{sub}</span>}
                    </button>
                  );
                })}
              {!searching && matches.length === 0 && (
                <div className={`px-3 ${pad} text-xs text-zinc-400`}>No matches.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
