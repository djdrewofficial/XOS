import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createEquipmentItem, createEquipmentSystem } from "./actions";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const supabase = await createClient();
  const [{ data: systems }, { data: items }, { data: photos }, { data: usage }] = await Promise.all([
    supabase.from("equipment_systems").select("*").order("name"),
    supabase.from("equipment_items").select("*").order("name"),
    supabase.from("equipment_photos").select("*").order("created_at"),
    supabase.from("event_equipment").select("item_id, system_id"),
  ]);

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
    <div className="max-w-6xl">
      <h1 className="page-title mb-1">Equipment</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Systems are racks/cases that travel as one unit; standalone items are grouped by category.
        Click anything to see its photos, contents, and event history.
      </p>

      {/* ---------- SYSTEMS ---------- */}
      <h2 className="card-title">Systems (Racks &amp; Cases)</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(systems ?? []).map((s) => {
          const inside = itemsBySystem.get(s.id) ?? [];
          const img = thumb("system", s.id);
          return (
            <Link key={s.id} href={`/equipment/system/${s.id}`} className={`card group overflow-hidden transition-shadow hover:shadow-lg ${!s.is_active ? "opacity-50" : ""}`}>
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
                <div className="mt-2 flex gap-3 text-[11px] font-semibold text-zinc-500">
                  <span>{inside.length} item{inside.length === 1 ? "" : "s"} inside</span>
                  <span>{eventCount.get(s.id) ?? 0} events</span>
                </div>
              </div>
            </Link>
          );
        })}
        <form action={createEquipmentSystem} className="card flex flex-col justify-center gap-2 border-dashed p-4">
          <div className="label-xs">New System</div>
          <input name="name" required placeholder="Name (e.g. FOH Rack)" className="input w-full" />
          <input name="description" placeholder="Description" className="input w-full" />
          <button className="btn-primary py-2 text-xs">Add System</button>
        </form>
      </div>

      {/* ---------- STANDALONE ITEMS BY CATEGORY ---------- */}
      <h2 className="card-title">Standalone Items</h2>
      {categories.map((cat) => (
        <div key={cat} className="mb-4">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{cat}</h3>
          <div className="card overflow-hidden">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {byCategory.get(cat)!.map((i) => {
                const img = thumb("item", i.id);
                return (
                  <li key={i.id}>
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
        <button className="btn-primary">Add Item</button>
      </form>
    </div>
  );
}
