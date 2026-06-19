"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SaveButton from "@/components/SaveButton";

type Venue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category_id: string | null;
  travel_fee: number;
  setup_fee: number;
  distance_miles: number | null;
  driving_notes: string | null;
  load_in_details: string | null;
  notes: string | null;
  is_one_time: boolean;
  auto_mileage: boolean;
  archived_at: string | null;
};

type Category = { id: string; name: string; is_active: boolean };
type DeleteResult = { deleted: number; skipped: { id: string; name: string; events: number }[] };

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/* fields offered in the merge "keep which value" picker */
const MERGE_FIELDS: { key: keyof Venue; label: string; kind: "text" | "money" | "num" | "bool" | "category" }[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "address", label: "Address", kind: "text" },
  { key: "city", label: "City", kind: "text" },
  { key: "state", label: "State", kind: "text" },
  { key: "zip", label: "Zip", kind: "text" },
  { key: "contact_name", label: "Contact Name", kind: "text" },
  { key: "phone", label: "Phone", kind: "text" },
  { key: "email", label: "Email", kind: "text" },
  { key: "website", label: "Website", kind: "text" },
  { key: "category_id", label: "Category", kind: "category" },
  { key: "travel_fee", label: "Travel Fee", kind: "money" },
  { key: "setup_fee", label: "Setup Fee", kind: "money" },
  { key: "distance_miles", label: "Distance (mi)", kind: "num" },
  { key: "driving_notes", label: "Driving Notes", kind: "text" },
  { key: "load_in_details", label: "Load-In", kind: "text" },
  { key: "notes", label: "Notes", kind: "text" },
  { key: "is_one_time", label: "One-Time", kind: "bool" },
  { key: "auto_mileage", label: "Auto Mileage", kind: "bool" },
];

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === 0 || v === false;

export default function VenuesDirectory({
  venues,
  categories,
  eventCounts,
  createVenue,
  archiveVenues,
  deleteVenues,
  mergeVenues,
}: {
  venues: Venue[];
  categories: Category[];
  eventCounts: Record<string, number>;
  createVenue: (formData: FormData) => Promise<void>;
  archiveVenues: (ids: string[], archive: boolean) => Promise<void>;
  deleteVenues: (ids: string[]) => Promise<DeleteResult>;
  mergeVenues: (survivorId: string, loserIds: string[], fields: Record<string, unknown>) => Promise<void>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [showOneTime, setShowOneTime] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const activeCategories = categories.filter((c) => c.is_active);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return venues.filter((v) => {
      if (!showArchived && v.archived_at) return false;
      if (!showOneTime && v.is_one_time) return false;
      if (categoryFilter && v.category_id !== categoryFilter) return false;
      if (!q) return true;
      const hay = [v.name, v.address, v.city, v.state, v.contact_name, v.phone, v.email, v.category_id ? catName.get(v.category_id) : "", v.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [venues, query, categoryFilter, showOneTime, showArchived, catName]);

  const selectedVenues = useMemo(() => venues.filter((v) => selected.has(v.id)), [venues, selected]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (filtered.every((v) => prev.has(v.id))) {
        const next = new Set(prev);
        filtered.forEach((v) => next.delete(v.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((v) => next.add(v.id));
      return next;
    });
  }
  const clear = () => setSelected(new Set());

  function runArchive(archive: boolean) {
    setMsg(null);
    const ids = [...selected];
    startTransition(async () => {
      await archiveVenues(ids, archive);
      setMsg(`${archive ? "Archived" : "Restored"} ${ids.length} venue${ids.length === 1 ? "" : "s"}.`);
      clear();
      router.refresh();
    });
  }
  function runDelete() {
    const ids = [...selected];
    if (!confirm(`Permanently delete ${ids.length} venue${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteVenues(ids);
      let m = `Deleted ${res.deleted} venue${res.deleted === 1 ? "" : "s"}.`;
      if (res.skipped.length) {
        m += ` Skipped ${res.skipped.length} still attached to events: ${res.skipped.map((s) => `${s.name} (${s.events})`).join(", ")}. Merge or archive those instead.`;
      }
      setMsg(m);
      clear();
      router.refresh();
    });
  }

  return (
    <div>
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search venues by name, city, category…"
          className="input min-w-64 flex-1 px-4 py-2.5"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input py-2.5">
          <option value="">All categories</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={showOneTime} onChange={(e) => setShowOneTime(e.target.checked)} className="size-4 accent-brand-light" />
          one-time
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-brand-light" />
          archived
        </label>
        <span className="text-xs text-zinc-500">{filtered.length} venues</span>
        <button onClick={() => setAddOpen(true)} className="btn-primary px-4 py-2 text-sm">+ Add Venue</button>
      </div>

      {/* bulk actions bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-2.5 dark:bg-brand/[0.12]">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => setMergeOpen(true)}
              disabled={selected.size < 2 || pending}
              className="btn-primary px-4 py-1.5 text-xs disabled:opacity-40"
              title={selected.size < 2 ? "Select 2 or more to merge" : "Merge selected venues"}
            >
              Merge
            </button>
            <button onClick={() => runArchive(true)} disabled={pending} className="btn-ghost px-4 py-1.5 text-xs disabled:opacity-50">Archive</button>
            <button onClick={() => runArchive(false)} disabled={pending} className="btn-ghost px-4 py-1.5 text-xs disabled:opacity-50">Restore</button>
            <button onClick={runDelete} disabled={pending} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">Delete</button>
            <button onClick={clear} disabled={pending} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Clear</button>
          </div>
        </div>
      )}
      {msg && <div className="mb-3 rounded-lg bg-black/[0.04] px-4 py-2 text-sm text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">{msg}</div>}

      {/* table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="w-10 px-3 py-2 text-center">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="size-4 accent-brand-light" aria-label="Select all" />
              </th>
              <th className="px-4 py-2 text-left">Venue</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-left">Address</th>
              <th className="px-4 py-2 text-right">Travel Fee</th>
              <th className="px-4 py-2 text-right">Setup Fee</th>
              <th className="px-4 py-2 text-center">Events</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const sel = selected.has(v.id);
              return (
                <tr
                  key={v.id}
                  onClick={() => router.push(`/venues/${v.id}`)}
                  className={`row cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${sel ? "bg-brand/[0.06] dark:bg-brand/[0.12]" : ""} ${v.archived_at ? "opacity-55" : ""}`}
                >
                  <td className="px-3 py-2.5 text-center" onClick={(e) => { e.stopPropagation(); toggle(v.id); }}>
                    <input type="checkbox" checked={sel} readOnly className="size-4 accent-brand-light" aria-label={`Select ${v.name}`} />
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-brand dark:text-brand-lighter">
                    {v.name}
                    {v.is_one_time && <span className="ml-2 rounded bg-black/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:bg-white/10">one-time</span>}
                    {v.archived_at && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">archived</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {v.category_id && catName.get(v.category_id) ? (
                      <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand/30 dark:text-brand-lighter">{catName.get(v.category_id)}</span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{[v.address, v.city, v.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right">{money(v.travel_fee)}</td>
                  <td className="px-4 py-2.5 text-right">{money(v.setup_fee)}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{eventCounts[v.id] ?? 0}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">No venues match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <AddVenueModal open={addOpen} onClose={() => setAddOpen(false)} categories={activeCategories} createVenue={createVenue} />
      {mergeOpen && (
        <MergeModal
          venues={selectedVenues}
          catName={catName}
          eventCounts={eventCounts}
          onClose={() => setMergeOpen(false)}
          onMerge={(survivorId, loserIds, fields) => {
            setMsg(null);
            startTransition(async () => {
              await mergeVenues(survivorId, loserIds, fields);
              setMsg(`Merged ${loserIds.length + 1} venues into one. Events stay associated via both IDs.`);
              setMergeOpen(false);
              clear();
              router.refresh();
            });
          }}
          pending={pending}
        />
      )}
    </div>
  );
}

/* ---------------- Merge modal ---------------- */
function MergeModal({
  venues,
  catName,
  eventCounts,
  onClose,
  onMerge,
  pending,
}: {
  venues: Venue[];
  catName: Map<string, string>;
  eventCounts: Record<string, number>;
  onClose: () => void;
  onMerge: (survivorId: string, loserIds: string[], fields: Record<string, unknown>) => void;
  pending: boolean;
}) {
  // default survivor = most events, then most filled-in fields
  const score = (v: Venue) =>
    (eventCounts[v.id] ?? 0) * 1000 + MERGE_FIELDS.filter((f) => !isEmpty(v[f.key])).length;
  const [survivorId, setSurvivorId] = useState(
    [...venues].sort((a, b) => score(b) - score(a))[0]?.id ?? venues[0]?.id,
  );
  // only USER overrides are stored; defaults are derived from the survivor below.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // default source for a field = survivor if it has a value, else first venue that does.
  const defaultSource = (f: (typeof MERGE_FIELDS)[number]): string => {
    const survivor = venues.find((v) => v.id === survivorId);
    if (survivor && !isEmpty(survivor[f.key])) return survivorId;
    const filled = venues.find((v) => !isEmpty(v[f.key]));
    return (filled ?? survivor ?? venues[0]).id;
  };
  const pickFor = (f: (typeof MERGE_FIELDS)[number]): string => overrides[String(f.key)] ?? defaultSource(f);
  // switching the survivor resets field choices to that survivor's defaults
  const chooseSurvivor = (id: string) => { setSurvivorId(id); setOverrides({}); };

  const fmt = (f: (typeof MERGE_FIELDS)[number], v: Venue): string => {
    const val = v[f.key];
    if (val === null || val === undefined || val === "") return "—";
    if (f.kind === "money") return money(Number(val));
    if (f.kind === "bool") return val ? "Yes" : "No";
    if (f.kind === "category") return catName.get(String(val)) ?? "—";
    return String(val);
  };

  function confirm() {
    const fields: Record<string, unknown> = {};
    for (const f of MERGE_FIELDS) {
      const src = venues.find((v) => v.id === pickFor(f)) ?? venues.find((v) => v.id === survivorId);
      if (src) fields[f.key as string] = src[f.key];
    }
    onMerge(survivorId, venues.filter((v) => v.id !== survivorId).map((v) => v.id), fields);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-full max-w-3xl flex-col bg-white/95 p-6 dark:bg-zinc-950/95" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Merge {venues.length} Venues</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-black/10 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">✕</button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Pick the record to keep, then choose which value wins for each field. The kept venue inherits the others&apos;
          events and DJEP IDs — nothing dis-associates.
        </p>

        {/* survivor picker */}
        <div className="mb-4 flex flex-wrap gap-2">
          {venues.map((v) => (
            <label
              key={v.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                survivorId === v.id ? "border-brand bg-brand/10 dark:bg-brand/20" : "border-zinc-200 dark:border-white/10"
              }`}
            >
              <input type="radio" name="survivor" checked={survivorId === v.id} onChange={() => chooseSurvivor(v.id)} className="accent-brand-light" />
              <span>
                <span className="font-semibold">{v.name}</span>
                <span className="ml-1.5 text-xs text-zinc-500">{[v.city, v.state].filter(Boolean).join(", ")} · {eventCounts[v.id] ?? 0} ev</span>
              </span>
            </label>
          ))}
        </div>

        {/* field-by-field keep picker */}
        <div className="-mx-1 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="px-2 py-1.5">Field</th>
                {venues.map((v) => (
                  <th key={v.id} className="px-2 py-1.5 font-semibold">{v.name}{v.id === survivorId && " ★"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MERGE_FIELDS.map((f) => {
                const allSame = venues.every((v) => fmt(f, v) === fmt(f, venues[0]));
                return (
                  <tr key={String(f.key)} className={`border-t border-zinc-100 dark:border-white/[0.06] ${allSame ? "opacity-60" : ""}`}>
                    <td className="px-2 py-2 font-medium text-zinc-500">{f.label}</td>
                    {venues.map((v) => (
                      <td key={v.id} className="px-2 py-2">
                        <label className="flex cursor-pointer items-start gap-1.5">
                          <input
                            type="radio"
                            name={`f_${String(f.key)}`}
                            checked={pickFor(f) === v.id}
                            onChange={() => setOverrides((p) => ({ ...p, [String(f.key)]: v.id }))}
                            className="mt-0.5 accent-brand-light"
                          />
                          <span className={`${pickFor(f) === v.id ? "font-semibold text-zinc-800 dark:text-zinc-100" : "text-zinc-500"}`}>{fmt(f, v)}</span>
                        </label>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-white/[0.06]">
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-xs">Cancel</button>
          <button type="button" onClick={confirm} disabled={pending} className="btn-primary px-5 py-2 text-xs disabled:opacity-50">
            {pending ? "Merging…" : `Merge into ${venues.find((v) => v.id === survivorId)?.name ?? "selected"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddVenueModal({
  open,
  onClose,
  categories,
  createVenue,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  createVenue: (formData: FormData) => Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-xl bg-white/95 p-6 dark:bg-zinc-950/95" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Add Venue</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-black/10 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">✕</button>
        </div>
        <form action={createVenue} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label-xs">Venue Name</label>
            <input name="name" required autoFocus className="input w-full" placeholder="Villa Toscana Miami" />
          </div>
          <div>
            <label className="label-xs">Category</label>
            <select name="category_id" className="input w-full">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Address</label>
            <input name="address" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">City</label>
            <input name="city" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">State</label>
            <input name="state" defaultValue="FL" className="input w-full" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Contact Name</label>
            <input name="contact_name" className="input w-full" placeholder="Main venue contact" />
          </div>
          <div>
            <label className="label-xs">Phone</label>
            <input name="phone" className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Email</label>
            <input type="email" name="email" className="input w-full" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Website</label>
            <input name="website" className="input w-full" placeholder="https://…" />
          </div>
          <div>
            <label className="label-xs">Travel Fee ($)</label>
            <input type="number" step="0.01" name="travel_fee" defaultValue={0} className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Setup Fee ($)</label>
            <input type="number" step="0.01" name="setup_fee" defaultValue={0} className="input w-full" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Load-In Details</label>
            <input name="load_in_details" className="input w-full" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Notes</label>
            <input name="notes" className="input w-full" />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="is_one_time" className="size-4 accent-brand-light" />
            One-time venue (someone&apos;s house, won&apos;t return)
          </label>
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-xs">Cancel</button>
            <SaveButton className="btn-primary px-5 py-2 text-xs" savedLabel="Added">Create Venue</SaveButton>
          </div>
        </form>
      </div>
    </div>
  );
}
