import { createClient } from "@/lib/supabase/server";
import VenuesDirectory from "@/components/VenuesDirectory";
import SaveButton from "@/components/SaveButton";
import {
  createVenue,
  createVenueCategory,
  toggleVenueCategory,
  archiveVenues,
  deleteVenues,
  mergeVenues,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const supabase = await createClient();
  const [{ data: venues }, { data: categories }, { data: events }] = await Promise.all([
    supabase.from("venues").select("*").order("name"),
    supabase.from("venue_categories").select("*").order("name"),
    supabase.from("events").select("venue_id"),
  ]);

  const eventCounts: Record<string, number> = {};
  (events ?? []).forEach((e) => {
    if (e.venue_id) eventCounts[e.venue_id] = (eventCounts[e.venue_id] ?? 0) + 1;
  });

  const categoryUsage: Record<string, number> = {};
  (venues ?? []).forEach((v) => {
    if (v.category_id) categoryUsage[v.category_id] = (categoryUsage[v.category_id] ?? 0) + 1;
  });

  return (
    <div className="max-w-6xl">
      <h1 className="page-title mb-5">Venues</h1>

      <VenuesDirectory
        venues={venues ?? []}
        categories={categories ?? []}
        eventCounts={eventCounts}
        createVenue={createVenue}
        archiveVenues={archiveVenues}
        deleteVenues={deleteVenues}
        mergeVenues={mergeVenues}
      />

      {/* ---------- VENUE SETTINGS: CATEGORIES ---------- */}
      <h2 className="card-title mt-10">Venue Categories</h2>
      <div className="card mb-3 overflow-hidden">
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(categories ?? []).map((c) => (
            <li key={c.id} className={`flex items-center justify-between px-4 py-2.5 text-sm ${!c.is_active ? "opacity-50" : ""}`}>
              <span>
                <span className="font-semibold">{c.name}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {categoryUsage[c.id] ?? 0} venue{(categoryUsage[c.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
              <form action={toggleVenueCategory.bind(null, c.id, !c.is_active)}>
                <button className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
                  {c.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </li>
          ))}
          {(categories ?? []).length === 0 && (
            <li className="px-4 py-4 text-sm text-zinc-500">No categories yet — run migration 00013.</li>
          )}
        </ul>
      </div>
      <form action={createVenueCategory} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-52 flex-1">
          <label className="label-xs">New Category</label>
          <input name="name" required className="input w-full" placeholder="e.g. Rooftop" />
        </div>
        <SaveButton savedLabel="Added">Add Category</SaveButton>
      </form>
    </div>
  );
}
