import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LiveFilter from "@/components/LiveFilter";
import SaveButton from "@/components/SaveButton";
import {
  createEquipmentItem,
  createEquipmentSystem,
  createStorageLocation,
  toggleStorageLocation,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const supabase = await createClient();
  const [{ data: systems }, { data: items }, { data: photos }, { data: usage }, { data: locations }, { data: openDamage }] =
    await Promise.all([
      supabase.from("equipment_systems").select("*").order("name"),
      supabase.from("equipment_items").select("*").order("name"),
      supabase.from("equipment_photos").select("*").order("created_at"),
      supabase.from("event_equipment").select("item_id, system_id"),
      supabase.from("equipment_storage_locations").select("*").order("name"),
      supabase.from("equipment_damage_reports").select("item_id").eq("status", "open"),
    ]);

  const locationName = new Map((locations ?? []).map((l) => [l.id as string, l.name as string]));
  const damageCount = new Map<string, number>();
  (openDamage ?? []).forEach((d) => damageCount.set(d.item_id, (damageCount.get(d.item_id) ?? 0) + 1));
  const locationUsage = new Map<string, number>();
  (items ?? []).forEach((i) => {
    if (i.storage_location_id) locationUsage.set(i.storage_location_id, (locationUsage.get(i.storage_location_id) ?? 0) + 1);
  });
  (systems ?? []).forEach((s) => {
    if (s.storage_location_id) locationUsage.set(s.storage_location_id, (locationUsage.get(s.storage_location_id) ?? 0) + 1);
  });

  const itemsBySystem = new Map<string, typeof items>();
  const standalone: NonNullable<typeof items> = [];
  (items ?? []).forEach((i) => {
    if (i.system_id) {
      if (!itemsBySystem.has(i.system_id)) itemsBySystem.set(i.system_id, []);
      itemsBySystem.get(i.system_id)!.push(i);
    } else {
      standalone.push(i);
    }
  });

  // standalone items grouped by their own category
  const byCategory = new Map<string, typeof standalone>();
  standalone.forEach((i) => {
    const cat = i.category?.trim() || "Uncategorized";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(i);
  });
  const categories = [...byCategory.keys()].sort();

  const eventCount = new Map<string, number>();
  (usage ?? []).forEach((u) => {
    const key = u.item_id ?? u.system_id;
    if (key) eventCount.set(key, (eventCount.get(key) ?? 0) + 1);
  });

  const thumb = (kind: "item" | "system", id: string) => {
    const p = (photos ?? []).find((ph) => (kind === "item" ? ph.item_id === id : ph.system_id === id));
    if (!p) return null;
    return supabase.storage.from("equipment").getPublicUrl(p.storage_path).data.publicUrl;
  };

  return (
    <div className="max-w-[1700px]" id="equipment-root">
      <h1 className="page-title mb-1">Equipment</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Systems are racks/cases that travel as one unit; standalone items are grouped by category.
        Click anything to see its photos, contents, and event history.
      </p>

      <div className="mb-5">
        <LiveFilter targetSelector="#equipment-root" placeholder="Search systems and items…" />
      </div>

      {/* ---------- SYSTEMS ---------- */}
      <h2 className="card-title">Systems (Racks &amp; Cases)</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(systems ?? []).map((s) => {
          const inside = itemsBySystem.get(s.id) ?? [];
          const img = thumb("system", s.id);
          return (
            <Link key={s.id} data-searchable href={`/equipment/system/${s.id}`} className={`card group overflow-hidden transition-shadow hover:shadow-lg ${!s.is_active ? "opacity-50" : ""}`}>
              <div className="flex h-28 items-center justify-center overflow-hidden bg-black/[0.04] dark:bg-white/[0.04]">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={s.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <span className="text-3xl opacity-30">📦</span>
                )}
              </div>
              <div className="p-4">
                <div className="font-bold text-zinc-900 dark:text-white">{s.name}</div>
                {s.description && <div className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{s.description}</div>}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold text-zinc-500">
                  <span>{inside.length} item{inside.length === 1 ? "" : "s"} inside</span>
                  <span>{eventCount.get(s.id) ?? 0} events</span>
                  {s.storage_location_id && locationName.get(s.storage_location_id) && (
                    <span className="text-brand dark:text-brand-lighter">📍 {locationName.get(s.storage_location_id)}</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
        <form action={createEquipmentSystem} className="card flex flex-col justify-center gap-2 border-dashed p-4">
          <div className="label-xs">New System</div>
          <input name="name" required placeholder="Name (e.g. FOH Rack)" className="input w-full" />
          <input name="description" placeholder="Description" className="input w-full" />
          <SaveButton className="btn-primary py-2 text-xs" savedLabel="Added">Add System</SaveButton>
        </form>
      </div>

      {/* ---------- STANDALONE ITEMS BY CATEGORY ---------- */}
      <h2 className="card-title">Standalone Items</h2>
      {categories.map((cat) => (
        <div key={cat} className="mb-4" data-search-group>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{cat}</h3>
          <div className="card overflow-hidden">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {byCategory.get(cat)!.map((i) => {
                const img = thumb("item", i.id);
                return (
                  <li key={i.id} data-searchable>
                    <Link
                      href={`/equipment/item/${i.id}`}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${!i.is_active ? "opacity-50" : ""}`}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={i.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="opacity-30">▤</span>
                        )}
                      </span>
                      <span className="flex-1">
                        <span className="font-semibold">{i.name}</span>
                        {(damageCount.get(i.id) ?? 0) > 0 && (
                          <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                            ⚠ DAMAGED
                          </span>
                        )}
                        {i.storage_location_id && locationName.get(i.storage_location_id) && (
                          <span className="ml-2 text-[11px] text-brand dark:text-brand-lighter">📍 {locationName.get(i.storage_location_id)}</span>
                        )}
                        {i.notes && <span className="ml-2 text-xs text-zinc-500">{i.notes}</span>}
                      </span>
                      <span className="text-[11px] font-semibold text-zinc-500">
                        {eventCount.get(i.id) ?? 0} events →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ))}
      {categories.length === 0 && (
        <p className="mb-4 text-sm text-zinc-500">No standalone items yet.</p>
      )}

      <h2 className="card-title mt-6">Add Item</h2>
      <form action={createEquipmentItem} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label-xs">Item Name</label>
          <input name="name" required className="input w-full" placeholder="Wireless Mic Kit" />
        </div>
        <div className="min-w-36">
          <label className="label-xs">Category</label>
          <input name="category" className="input w-full" placeholder="Audio" list="equip-categories" />
          <datalist id="equip-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="min-w-44">
          <label className="label-xs">Inside System (optional)</label>
          <select name="system_id" className="input w-full">
            <option value="">— standalone —</option>
            {(systems ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <SaveButton savedLabel="Added">Add Item</SaveButton>
      </form>

      {/* ---------- STORAGE LOCATIONS ---------- */}
      <h2 className="card-title mt-8">Storage Locations</h2>
      <div className="card mb-3 overflow-hidden">
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(locations ?? []).map((l) => (
            <li key={l.id} className={`flex items-center justify-between px-4 py-2.5 text-sm ${!l.is_active ? "opacity-50" : ""}`}>
              <span>
                <span className="font-semibold">📍 {l.name}</span>
                {l.notes && <span className="ml-2 text-xs text-zinc-500">{l.notes}</span>}
                <span className="ml-2 text-xs text-zinc-500">
                  {locationUsage.get(l.id) ?? 0} thing{(locationUsage.get(l.id) ?? 0) === 1 ? "" : "s"} stored here
                </span>
              </span>
              <form action={toggleStorageLocation.bind(null, l.id, !l.is_active)}>
                <button className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
                  {l.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </li>
          ))}
          {(locations ?? []).length === 0 && (
            <li className="px-4 py-4 text-sm text-zinc-500">No storage locations yet.</li>
          )}
        </ul>
      </div>
      <form action={createStorageLocation} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label-xs">New Location</label>
          <input name="name" required className="input w-full" placeholder="Warehouse Shelf B" />
        </div>
        <div className="min-w-52 flex-1">
          <label className="label-xs">Notes</label>
          <input name="notes" className="input w-full" placeholder="e.g. back room, behind the trailer" />
        </div>
        <SaveButton savedLabel="Added">Add Location</SaveButton>
      </form>
    </div>
  );
}
