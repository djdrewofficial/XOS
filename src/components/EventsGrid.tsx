"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type GridRow = {
  id: string;
  statusColor: string | null;
  statusFg: string | null;
  values: Record<string, string | number | null>;
};

type ColumnDef = { id: string; label: string; align?: "right"; money?: boolean };

const ALL_COLUMNS: ColumnDef[] = [
  { id: "event_number", label: "Event ID" },
  { id: "event_date", label: "Event Date" },
  { id: "event_name", label: "Event Name" },
  { id: "event_type", label: "Event Type" },
  { id: "client", label: "Client" },
  { id: "client_cell", label: "Client Cell Phone" },
  { id: "client_email", label: "Client Email" },
  { id: "status", label: "Status" },
  { id: "package", label: "Package" },
  { id: "addons", label: "Add-Ons" },
  { id: "balance_due", label: "Balance Due", align: "right", money: true },
  { id: "total_fee", label: "Total Fee", align: "right", money: true },
  { id: "payments_received", label: "Payments Received", align: "right", money: true },
  { id: "venue", label: "Venue" },
  { id: "salesperson", label: "Salesperson" },
  { id: "assigned_employees", label: "Assigned Employees" },
  { id: "assigned_vendors", label: "Assigned Vendors" },
  { id: "inquiry_source", label: "Inquiry Source" },
  { id: "guest_count", label: "Guest Count", align: "right" },
  { id: "setup_time", label: "Setup Time" },
  { id: "start_time", label: "Start Time" },
  { id: "end_time", label: "End Time" },
  { id: "booked_date", label: "Date Booked" },
  { id: "contract_sent", label: "Contract Sent" },
  { id: "contract_due", label: "Contract Due" },
  { id: "initial_contact", label: "Initial Contact" },
  { id: "created", label: "Inquiry Created" },
];

const DEFAULT_VISIBLE = [
  "event_date", "event_name", "event_type", "client", "client_cell", "status",
  "package", "balance_due", "total_fee", "venue", "salesperson", "assigned_employees",
];

const STORAGE_KEY = "xos-events-columns";
const SETTINGS_KEY = "xos-events-settings";

type StatusColorMode = "row" | "cell" | "none";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function EventsGrid({ rows }: { rows: GridRow[] }) {
  const router = useRouter();
  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "event_date", dir: 1 });
  const [view, setView] = useState<"upcoming" | "past" | "all">("upcoming");
  const [statusColorMode, setStatusColorMode] = useState<StatusColorMode>("row");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed) && parsed.length) setVisible(parsed.filter((c) => ALL_COLUMNS.some((a) => a.id === c)));
      }
    } catch {}
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const s = JSON.parse(saved) as { statusColorMode?: StatusColorMode; sortBy?: string; sortDir?: 1 | -1 };
        if (s.statusColorMode) setStatusColorMode(s.statusColorMode);
        if (s.sortBy && ALL_COLUMNS.some((c) => c.id === s.sortBy)) {
          setSort({ col: s.sortBy, dir: s.sortDir === -1 ? -1 : 1 });
        }
      }
    } catch {}
    try {
      if (new URLSearchParams(window.location.search).get("settings") === "1") setSettingsOpen(true);
    } catch {}
    setLoaded(true);
  }, []);

  // persist appearance + default sort whenever they change
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ statusColorMode, sortBy: sort.col, sortDir: sort.dir }));
    } catch {}
  }, [statusColorMode, sort, loaded]);

  function saveVisible(cols: string[]) {
    setVisible(cols);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
    } catch {}
  }

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    let out = rows;
    if (view !== "all") {
      out = out.filter((r) => {
        const d = r.values.event_date as string | null;
        if (!d) return view === "upcoming";
        return view === "upcoming" ? d >= today : d < today;
      });
    }
    for (const [col, q] of Object.entries(filters)) {
      const needle = q.trim().toLowerCase();
      if (!needle) continue;
      out = out.filter((r) => {
        const v = r.values[col];
        if (v === null || v === undefined) return false;
        const def = ALL_COLUMNS.find((c) => c.id === col);
        const display = def?.money && typeof v === "number" ? money(v) : String(v);
        return display.toLowerCase().includes(needle);
      });
    }
    const dir = sort.dir;
    const col = sort.col;
    return [...out].sort((a, b) => {
      const av = a.values[col];
      const bv = b.values[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, filters, sort, view, today]);

  const cols = visible
    .map((id) => ALL_COLUMNS.find((c) => c.id === id))
    .filter(Boolean) as ColumnDef[];

  const hidden = ALL_COLUMNS.filter((c) => !visible.includes(c.id));

  return (
    <div>
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {(["upcoming", "past", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition-colors ${
              view === v
                ? "bg-gradient-to-r from-brand to-brand-light text-white"
                : "border border-zinc-300 bg-white text-zinc-600 hover:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400"
            }`}
          >
            {v}
          </button>
        ))}
        <span className="text-xs text-zinc-500">{filtered.length} events</span>
        <span className="flex-1" />
        {Object.values(filters).some((f) => f.trim()) && (
          <button onClick={() => setFilters({})} className="text-xs font-semibold text-zinc-500 hover:underline">
            Clear filters
          </button>
        )}
        <button onClick={() => setSettingsOpen(true)} className="btn-ghost px-3.5 py-1.5 text-xs">
          ⚙ Columns
        </button>
      </div>

      {/* grid */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* filter row */}
            <tr className="bg-black/[0.02] dark:bg-white/[0.02]">
              {cols.map((c) => (
                <th key={c.id} className="px-1.5 pt-2 pb-1">
                  <input
                    value={filters[c.id] ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.id]: e.target.value }))}
                    placeholder="search…"
                    className="input w-full min-w-20 px-2 py-1 text-xs font-normal"
                  />
                </th>
              ))}
            </tr>
            {/* header row */}
            <tr className="table-head">
              {cols.map((c) => (
                <th
                  key={c.id}
                  onClick={() =>
                    setSort((s) => ({ col: c.id, dir: s.col === c.id ? ((s.dir * -1) as 1 | -1) : 1 }))
                  }
                  className={`cursor-pointer px-3 py-2 select-none hover:text-brand dark:hover:text-brand-lighter ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                  <span className="ml-1 opacity-60">
                    {sort.col === c.id ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/events/${r.id}`)}
                className="row cursor-pointer"
                style={statusColorMode === "row" && r.statusColor ? { backgroundColor: `${r.statusColor}2e` } : undefined}
              >
                {cols.map((c) => {
                  const v = r.values[c.id];
                  let display: string;
                  if (v === null || v === undefined) display = "—";
                  else if (c.money && typeof v === "number") display = money(v);
                  else display = String(v);
                  if (c.id === "status" && v) {
                    return (
                      <td key={c.id} className="px-3 py-2 whitespace-nowrap">
                        {statusColorMode === "none" ? (
                          display
                        ) : (
                          <span
                            className="chip"
                            style={{ backgroundColor: r.statusColor ?? "#ccc", color: r.statusFg ?? "#000" }}
                          >
                            {display}
                          </span>
                        )}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.id}
                      className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""} ${c.id === "event_name" ? "font-semibold" : ""} ${c.id === "event_date" ? "whitespace-nowrap" : ""}`}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-10 text-center text-zinc-500">
                  No events match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* settings panel */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
          <div className="card w-full max-w-2xl bg-white/95 p-6 dark:bg-zinc-950/95" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Event List Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="btn-primary px-4 py-1.5 text-xs">
                Done
              </button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="card-title">Show These Fields</h3>
                <ul className="space-y-1">
                  {visible.map((id, idx) => {
                    const def = ALL_COLUMNS.find((c) => c.id === id);
                    if (!def) return null;
                    return (
                      <li key={id} className="flex items-center justify-between rounded-lg bg-black/[0.04] px-3 py-1.5 text-sm dark:bg-white/[0.06]">
                        <span>{def.label}</span>
                        <span className="flex gap-1">
                          <button
                            disabled={idx === 0}
                            onClick={() => {
                              const next = [...visible];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              saveVisible(next);
                            }}
                            className="rounded px-1.5 text-xs text-zinc-500 hover:bg-black/10 disabled:opacity-30 dark:hover:bg-white/10"
                          >
                            ↑
                          </button>
                          <button
                            disabled={idx === visible.length - 1}
                            onClick={() => {
                              const next = [...visible];
                              [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                              saveVisible(next);
                            }}
                            className="rounded px-1.5 text-xs text-zinc-500 hover:bg-black/10 disabled:opacity-30 dark:hover:bg-white/10"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => saveVisible(visible.filter((c) => c !== id))}
                            className="rounded px-1.5 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <h3 className="card-title">Available Options</h3>
                <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                  {hidden.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => saveVisible([...visible, c.id])}
                        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-1.5 text-left text-sm transition-colors hover:border-brand dark:border-white/10 dark:hover:border-brand-light"
                      >
                        {c.label}
                        <span className="text-xs font-bold text-brand dark:text-brand-lighter">+ add</span>
                      </button>
                    </li>
                  ))}
                  {hidden.length === 0 && <li className="text-xs text-zinc-500">Everything is shown.</li>}
                </ul>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              Use ↑ ↓ to reorder. Your column setup is saved on this browser.
            </p>

            <div className="mt-6 grid gap-5 border-t border-zinc-200 pt-5 dark:border-white/10 sm:grid-cols-2">
              <div>
                <h3 className="card-title">Appearance</h3>
                <label className="label-xs">Apply Status Color To</label>
                <select
                  value={statusColorMode}
                  onChange={(e) => setStatusColorMode(e.target.value as StatusColorMode)}
                  className="input w-full"
                >
                  <option value="row">Entire Row</option>
                  <option value="cell">Status Field Only</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <h3 className="card-title">Default Sort Order</h3>
                <p className="mb-2 text-[11px] text-zinc-500">Controls how the list is ordered when it loads.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label-xs">Sort By</label>
                    <select
                      value={sort.col}
                      onChange={(e) => setSort((s) => ({ ...s, col: e.target.value }))}
                      className="input w-full"
                    >
                      {ALL_COLUMNS.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-xs">Sort Order</label>
                    <select
                      value={String(sort.dir)}
                      onChange={(e) => setSort((s) => ({ ...s, dir: e.target.value === "-1" ? -1 : 1 }))}
                      className="input w-full"
                    >
                      <option value="1">Ascending</option>
                      <option value="-1">Descending</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
