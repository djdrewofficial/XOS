import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  updateEquipmentItem,
  uploadEquipmentPhoto,
  deleteEquipmentPhoto,
  reportDamage,
  addDamagePhoto,
  resolveDamage,
} from "../../actions";
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

  const [{ data: item }, { data: systems }, { data: photos }, { data: assignments }, { data: locations }, { data: damageReports }] =
    await Promise.all([
      supabase.from("equipment_items").select("*, system:equipment_systems(id, name)").eq("id", id).single(),
      supabase.from("equipment_systems").select("id, name").eq("is_active", true).order("name"),
      supabase.from("equipment_photos").select("*").eq("item_id", id).order("created_at"),
      supabase
        .from("event_equipment")
        .select("*, event:events(id, name, event_date, venue:venues(name), status:event_statuses(name, color, text_color))")
        .eq("item_id", id),
      supabase.from("equipment_storage_locations").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("equipment_damage_reports")
        .select("*")
        .eq("item_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (!item) notFound();

  const reportIds = (damageReports ?? []).map((r) => r.id);
  const { data: damagePhotos } = reportIds.length
    ? await supabase.from("equipment_photos").select("*").in("damage_report_id", reportIds)
    : { data: [] as { id: string; damage_report_id: string | null; storage_path: string }[] };
  const damagePhotoUrl = (path: string) =>
    supabase.storage.from("equipment").getPublicUrl(path).data.publicUrl;
  const openDamage = (damageReports ?? []).filter((r) => r.status === "open").length;

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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-xs">Date Purchased</label>
                <input type="date" name="date_purchased" defaultValue={item.date_purchased ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Retailer Purchased From</label>
                <input name="retailer" defaultValue={item.retailer ?? ""} className="input w-full" placeholder="Sweetwater, Amazon…" />
              </div>
              <div>
                <label className="label-xs">Serial Number</label>
                <input name="serial_number" defaultValue={item.serial_number ?? ""} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Stored At</label>
                <select name="storage_location_id" defaultValue={item.storage_location_id ?? ""} className="input w-full">
                  <option value="">—</option>
                  {(locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
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

      {/* ---------- DAMAGE REPORTS ---------- */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="card-title mb-0">Damage Reports</h2>
          {openDamage > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
              {openDamage} open
            </span>
          )}
        </div>
        <div className="card p-5">
          <form action={reportDamage.bind(null, id)} className="mb-5 space-y-2 border-b border-zinc-100 pb-5 dark:border-white/[0.06]">
            <label className="label-xs">Report Damage</label>
            <textarea
              name="description"
              rows={2}
              required
              placeholder="What happened? e.g. Left output crackles — dropped during load-out at Villa Toscana."
              className="input w-full"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                name="photo"
                accept="image/*"
                className="block text-xs text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-black/[0.07] file:px-3 file:py-1.5 file:text-xs file:font-semibold dark:file:bg-white/10 dark:file:text-zinc-200"
              />
              <button className="btn-danger px-4 py-1.5 text-xs">Report Damage</button>
            </div>
          </form>

          <ul className="space-y-3">
            {(damageReports ?? []).map((r) => {
              const rPhotos = (damagePhotos ?? []).filter((p) => p.damage_report_id === r.id);
              return (
                <li key={r.id} className={`rounded-xl border p-3 ${r.status === "open" ? "border-red-400/40 bg-red-500/[0.04]" : "border-zinc-200 opacity-70 dark:border-white/10"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className={`chip ${r.status === "open" ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>
                        {r.status === "open" ? "OPEN" : "RESOLVED"}
                      </span>
                      <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">{r.description}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {r.reported_by} · {new Date(r.created_at).toLocaleString()}
                        {r.resolved_at && ` · resolved ${new Date(r.resolved_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    {r.status === "open" && (
                      <form action={resolveDamage.bind(null, id, r.id)}>
                        <button className="btn-ghost px-3 py-1 text-xs">Mark Resolved</button>
                      </form>
                    )}
                  </div>
                  {rPhotos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rPhotos.map((p) => (
                        <a key={p.id} href={damagePhotoUrl(p.storage_path)} target="_blank">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={damagePhotoUrl(p.storage_path)} alt="damage" className="h-20 w-20 rounded-lg object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {r.status === "open" && (
                    <form action={addDamagePhoto.bind(null, id, r.id)} className="mt-2 flex items-center gap-2">
                      <input
                        type="file"
                        name="photo"
                        accept="image/*"
                        required
                        className="block text-xs text-zinc-500 file:mr-2 file:rounded file:border-0 file:bg-black/[0.07] file:px-2 file:py-1 file:text-[10px] dark:file:bg-white/10 dark:file:text-zinc-200"
                      />
                      <button className="btn-ghost px-2.5 py-0.5 text-[10px]">Add Photo</button>
                    </form>
                  )}
                </li>
              );
            })}
            {(damageReports ?? []).length === 0 && (
              <li className="text-sm text-zinc-500">No damage reported — knock on wood.</li>
            )}
          </ul>
        </div>
      </div>

      <EquipmentHistory assignments={assignments ?? []} />
    </div>
  );
}
