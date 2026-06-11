"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Venue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  category_id: string | null;
  travel_fee: number;
  setup_fee: number;
  notes: string | null;
  is_one_time: boolean;
};

type Category = { id: string; name: string; is_active: boolean };

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function VenuesDirectory({
  venues,
  categories,
  eventCounts,
  createVenue,
}: {
  venues: Venue[];
  categories: Category[];
  eventCounts: Record<string, number>;
  createVenue: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [showOneTime, setShowOneTime] = useState(false);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const activeCategories = categories.filter((c) => c.is_active);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return venues.filter((v) => {
      if (!showOneTime && v.is_one_time) return false;
      if (categoryFilter && v.category_id !== categoryFilter) return false;
      if (!q) return true;
      const hay = [v.name, v.address, v.city, v.state, v.category_id ? catName.get(v.category_id) : "", v.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [venues, query, categoryFilter, showOneTime, catName]);

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
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input py-2.5"
        >
          <option value="">All categories</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={showOneTime}
            onChange={(e) => setShowOneTime(e.target.checked)}
            className="size-4 accent-brand-light"
          />
          show one-time venues
        </label>
        <span className="text-xs text-zinc-500">{filtered.length} venues</span>
        <button onClick={() => setAddOpen(true)} className="btn-primary px-4 py-2 text-sm">
          + Add Venue
        </button>
      </div>

      {/* table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Venue</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-left">Address</th>
              <th className="px-4 py-2 text-right">Travel Fee</th>
              <th className="px-4 py-2 text-right">Setup Fee</th>
              <th className="px-4 py-2 text-center">Events</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr
                key={v.id}
                onClick={() => router.push(`/venues/${v.id}`)}
                className="row cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <td className="px-4 py-2.5 font-semibold text-brand dark:text-brand-lighter">
                  {v.name}
                  {v.is_one_time && (
                    <span className="ml-2 rounded bg-black/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:bg-white/10">
                      one-time
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {v.category_id && catName.get(v.category_id) ? (
                    <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand/30 dark:text-brand-lighter">
                      {catName.get(v.category_id)}
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                  {[v.address, v.city, v.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-2.5 text-right">{money(v.travel_fee)}</td>
                <td className="px-4 py-2.5 text-right">{money(v.setup_fee)}</td>
                <td className="px-4 py-2.5 text-center font-semibold">{eventCounts[v.id] ?? 0}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  No venues match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AddVenueModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        categories={activeCategories}
        createVenue={createVenue}
      />
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
            <button className="btn-primary px-5 py-2 text-xs">Create Venue</button>
          </div>
        </form>
      </div>
    </div>
  );
}
