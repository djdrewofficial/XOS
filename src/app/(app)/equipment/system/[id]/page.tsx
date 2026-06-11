import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  updateEquipmentSystem,
  uploadEquipmentPhoto,
  deleteEquipmentPhoto,
  addItemToSystemForm,
  setItemSystem,
  createEquipmentItem,
} from "../../actions";
import EquipmentHistory from "@/components/EquipmentHistory";
import PhotoGallery from "@/components/PhotoGallery";

export const dynamic = "force-dynamic";

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: system }, { data: items }, { data: standalone }, { data: photos }, { data: assignments }, { data: locations }] =
    await Promise.all([
      supabase.from("equipment_systems").select("*").eq("id", id).single(),
      supabase.from("equipment_items").select("*").eq("system_id", id).order("name"),
      supabase.from("equipment_items").select("id, name, category").is("system_id", null).eq("is_active", true).order("name"),
      supabase.from("equipment_photos").select("*").eq("system_id", id).order("created_at"),
      supabase
        .from("event_equipment")
        .select("*, event:events(id, name, event_date, venue:venues(name), status:event_statuses(name, color, text_color))")
        .eq("system_id", id),
      supabase.from("equipment_storage_locations").select("id, name").eq("is_active", true).order("name"),
    ]);

  if (!system) notFound();

  const photoUrls = (photos ?? []).map((p) => ({
    id: p.id,
    path: p.storage_path,
    url: supabase.storage.from("equipment").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <Link href="/equipment" className="text-xs font-semibold text-zinc-500 hover:underline">← All Equipment</Link>
        <h1 className="page-title mt-1">{system.name}</h1>
        <p className="text-sm text-zinc-500">System · {(items ?? []).length} items inside</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="card-title">System Details</h2>
            <form action={updateEquipmentSystem.bind(null, id)} className="space-y-3">
              <div>
                <label className="label-xs">Name</label>
                <input name="name" defaultValue={system.name} required className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Description</label>
                <textarea name="description" rows={2} defaultValue={system.description ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Stored At</label>
                <select name="storage_location_id" defaultValue={system.storage_location_id ?? ""} className="input w-full">
                  <option value="">—</option>
                  {(locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" name="is_active" defaultChecked={system.is_active} className="size-4 accent-brand-light" />
                Active
              </label>
              <button className="btn-primary">Save</button>
            </form>
          </div>

          <PhotoGallery
            photos={photoUrls}
            upload={uploadEquipmentPhoto.bind(null, "system", id)}
            remove={deleteEquipmentPhoto.bind(null, "system", id)}
          />
        </div>

        <div className="card p-5">
          <h2 className="card-title">What&apos;s Inside This System</h2>
          <ul className="mb-4 divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {(items ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <Link href={`/equipment/item/${i.id}`} className="font-semibold text-brand dark:text-brand-lighter hover:underline">
                    {i.name}
                  </Link>
                  {i.category && <span className="ml-2 text-xs text-zinc-500">{i.category}</span>}
                  {i.notes && <span className="ml-2 text-xs text-zinc-500">— {i.notes}</span>}
                </span>
                <form action={setItemSystem.bind(null, i.id, null, `/equipment/system/${id}`)}>
                  <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline" title="Make standalone">
                    Remove
                  </button>
                </form>
              </li>
            ))}
            {(items ?? []).length === 0 && <li className="py-2 text-sm text-zinc-500">Nothing inside yet.</li>}
          </ul>

          <h3 className="label-xs">Move An Existing Item In</h3>
          <form action={addItemToSystemForm.bind(null, id)} className="mb-4 flex gap-2">
            <select name="item_id" required className="input w-full">
              <option value="">Select standalone item…</option>
              {(standalone ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}{i.category ? ` — ${i.category}` : ""}
                </option>
              ))}
            </select>
            <button className="btn-ghost px-4 py-1.5 text-xs">Move In</button>
          </form>

          <h3 className="label-xs">Or Create A New Item Inside</h3>
          <form action={createEquipmentItem} className="flex flex-wrap gap-2">
            <input type="hidden" name="system_id" value={id} />
            <input name="name" required placeholder="Item name" className="input min-w-40 flex-1" />
            <input name="category" placeholder="Category" className="input w-32" />
            <button className="btn-ghost px-4 py-1.5 text-xs">Add</button>
          </form>
        </div>
      </div>

      <EquipmentHistory assignments={assignments ?? []} />
    </div>
  );
}
