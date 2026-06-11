import { createClient } from "@/lib/supabase/server";
import {
  createEquipmentItem,
  createEquipmentSystem,
  updateEquipmentItem,
  updateEquipmentSystem,
} from "./actions";

export const dynamic = "force-dynamic";


export default async function EquipmentPage() {
  const supabase = await createClient();
  const [{ data: systems }, { data: items }] = await Promise.all([
    supabase.from("equipment_systems").select("*").order("name"),
    supabase.from("equipment_items").select("*").order("name"),
  ]);

  const itemsBySystem = new Map<string, number>();
  (items ?? []).forEach((i) => {
    if (i.system_id) itemsBySystem.set(i.system_id, (itemsBySystem.get(i.system_id) ?? 0) + 1);
  });

  return (
    <div className="max-w-6xl">
      <h1 className="page-title mb-1">Equipment</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Items are individual pieces of gear; Systems are racks/cases that hold multiple things and travel as one unit.
      </p>

      {/* ---------- SYSTEMS ---------- */}
      <h2 className="card-title">Systems (Racks &amp; Cases)</h2>
      <div className="card mb-4 overflow-hidden">
        <div className="table-head flex items-center py-2">
          <span className="w-[28%] px-3">System</span>
          <span className="w-[42%] px-2">Description</span>
          <span className="w-[12%] px-2 text-center">Items Inside</span>
          <span className="w-[8%] text-center">Active</span>
          <span className="w-[10%] px-3 text-right">Save</span>
        </div>
        {(systems ?? []).map((s) => (
          <div key={s.id} className={`row flex w-full items-center py-1.5 ${!s.is_active ? "opacity-50" : ""}`}>
            <form action={updateEquipmentSystem.bind(null, s.id)} className="contents">
              <span className="w-[28%] px-3">
                <input name="name" defaultValue={s.name} className="input w-full py-1.5" />
              </span>
              <span className="w-[42%] px-2">
                <input name="description" defaultValue={s.description ?? ""} className="input w-full py-1.5" />
              </span>
              <span className="w-[12%] px-2 text-center text-sm font-semibold">{itemsBySystem.get(s.id) ?? 0}</span>
              <span className="w-[8%] text-center">
                <input type="checkbox" name="is_active" defaultChecked={s.is_active} className="size-4 accent-brand-light" />
              </span>
              <span className="flex w-[10%] justify-end px-3">
                <button className="btn-ghost px-3 py-1 text-xs">Save</button>
              </span>
            </form>
          </div>
        ))}
      </div>
      <form action={createEquipmentSystem} className="card mb-8 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label-xs">New System Name</label>
          <input name="name" required className="input w-full" placeholder="FOH Rack" />
        </div>
        <div className="min-w-52 flex-1">
          <label className="label-xs">Description</label>
          <input name="description" className="input w-full" placeholder="What lives in it" />
        </div>
        <button className="btn-primary">Add System</button>
      </form>

      {/* ---------- ITEMS ---------- */}
      <h2 className="card-title">Equipment Items</h2>
      <div className="card mb-4 overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className="table-head flex items-center py-2">
            <span className="w-[26%] px-3">Item</span>
            <span className="w-[15%] px-2">Category</span>
            <span className="w-[20%] px-2">Inside System</span>
            <span className="w-[24%] px-2">Notes</span>
            <span className="w-[6%] text-center">Active</span>
            <span className="w-[9%] px-3 text-right">Save</span>
          </div>
          {(items ?? []).map((i) => (
            <div key={i.id} className={`row flex w-full items-center py-1.5 ${!i.is_active ? "opacity-50" : ""}`}>
              <form action={updateEquipmentItem.bind(null, i.id)} className="contents">
                <span className="w-[26%] px-3">
                  <input name="name" defaultValue={i.name} className="input w-full py-1.5" />
                </span>
                <span className="w-[15%] px-2">
                  <input name="category" defaultValue={i.category ?? ""} className="input w-full py-1.5" />
                </span>
                <span className="w-[20%] px-2">
                  <select name="system_id" defaultValue={i.system_id ?? ""} className="input w-full py-1.5">
                    <option value="">— standalone —</option>
                    {(systems ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </span>
                <span className="w-[24%] px-2">
                  <input name="notes" defaultValue={i.notes ?? ""} className="input w-full py-1.5" />
                </span>
                <span className="w-[6%] text-center">
                  <input type="checkbox" name="is_active" defaultChecked={i.is_active} className="size-4 accent-brand-light" />
                </span>
                <span className="flex w-[9%] justify-end px-3">
                  <button className="btn-ghost px-3 py-1 text-xs">Save</button>
                </span>
              </form>
            </div>
          ))}
        </div>
      </div>
      <form action={createEquipmentItem} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label-xs">New Item Name</label>
          <input name="name" required className="input w-full" placeholder="Wireless Mic Kit" />
        </div>
        <div className="min-w-36">
          <label className="label-xs">Category</label>
          <input name="category" className="input w-full" placeholder="Audio" />
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
