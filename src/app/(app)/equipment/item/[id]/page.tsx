import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateEquipmentItem, uploadEquipmentPhoto, deleteEquipmentPhoto } from "../../actions";
import EquipmentHistory from "@/components/EquipmentHistory";
import PhotoGallery from "@/components/PhotoGallery";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: item }, { data: systems }, { data: photos }, { data: assignments }] = await Promise.all([
    supabase.from("equipment_items").select("*, system:equipment_systems(id, name)").eq("id", id).single(),
    supabase.from("equipment_systems").select("id, name").eq("is_active", true).order("name"),
    supabase.from("equipment_photos").select("*").eq("item_id", id).order("created_at"),
    supabase
      .from("event_equipment")
      .select("*, event:events(id, name, event_date, venue:venues(name), status:event_statuses(name, color, text_color))")
      .eq("item_id", id),
  ]);

  if (!item) notFound();

  const photoUrls = (photos ?? []).map((p) => ({
    id: p.id,
    path: p.storage_path,
    url: supabase.storage.from("equipment").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  const sys = item.system as unknown as { id: string; name: string } | null;

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <Link href="/equipment" className="text-xs font-semibold text-zinc-500 hover:underline">← All Equipment</Link>
        <h1 className="page-title mt-1">{item.name}</h1>
        <p className="text-sm text-zinc-500">
          {item.category ?? "Item"}
          {sys && (
            <>
              {" "}· inside{" "}
              <Link href={`/equipment/system/${sys.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                {sys.name}
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Item Details</h2>
          <form action={updateEquipmentItem.bind(null, id)} className="space-y-3">
            <div>
              <label className="label-xs">Name</label>
              <input name="name" defaultValue={item.name} required className="input w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-xs">Category</label>
                <input name="category" defaultValue={item.category ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Inside System</label>
                <select name="system_id" defaultValue={item.system_id ?? ""} className="input w-full">
                  <option value="">— standalone —</option>
                  {(systems ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label-xs">Notes</label>
              <textarea name="notes" rows={2} defaultValue={item.notes ?? ""} className="input w-full" placeholder="Quirks, maintenance, what cables it needs…" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="is_active" defaultChecked={item.is_active} className="size-4 accent-brand-light" />
              Active
            </label>
            <button className="btn-primary">Save</button>
          </form>
        </div>

        <PhotoGallery
          photos={photoUrls}
          upload={uploadEquipmentPhoto.bind(null, "item", id)}
          remove={deleteEquipmentPhoto.bind(null, "item", id)}
        />
      </div>

      <EquipmentHistory assignments={assignments ?? []} />
    </div>
  );
}
