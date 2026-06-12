import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import Tabs from "@/components/Tabs";
import SaveButton from "@/components/SaveButton";
import VersionSaveButtons from "@/components/VersionSaveButtons";
import { updateAddonSettings, deleteAddon, saveAddonEquipmentDefaults } from "@/app/(app)/packages/actions";

export const dynamic = "force-dynamic";

export default async function AddonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: addon }, { data: categories }, { data: equipDefaults }, { data: items }, { data: systems }, { count: usedCount }] =
    await Promise.all([
      supabase.from("addons").select("*").eq("id", id).single(),
      supabase.from("addon_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("addon_equipment_defaults").select("*").eq("addon_id", id),
      supabase.from("equipment_items").select("*").eq("is_active", true).is("system_id", null).order("name"),
      supabase.from("equipment_systems").select("*").eq("is_active", true).order("name"),
      supabase.from("event_addons").select("id", { count: "exact", head: true }).eq("addon_id", id),
    ]);

  if (!addon) notFound();

  // version history + which versions events are pinned to
  const [{ data: versions }, { data: pinnedAddons }] = await Promise.all([
    supabase
      .from("addon_versions")
      .select("version_no, created_at, snapshot")
      .eq("addon_id", id)
      .order("version_no", { ascending: false }),
    supabase.from("event_addons").select("addon_version_no").eq("addon_id", id),
  ]);
  const pinCounts = new Map<number, number>();
  (pinnedAddons ?? []).forEach((e) => {
    const v = (e as { addon_version_no: number | null }).addon_version_no;
    if (v != null) pinCounts.set(v, (pinCounts.get(v) ?? 0) + 1);
  });
  const currentVersion: number = addon.current_version ?? 1;

  const systemAssigned = new Set((equipDefaults ?? []).filter((e) => e.system_id).map((e) => e.system_id));
  const itemQty = new Map((equipDefaults ?? []).filter((e) => e.item_id).map((e) => [e.item_id, e.quantity]));

  const itemsByCat = new Map<string, NonNullable<typeof items>>();
  (items ?? []).forEach((i) => {
    const cat = i.category?.trim() || "Uncategorized";
    if (!itemsByCat.has(cat)) itemsByCat.set(cat, []);
    itemsByCat.get(cat)!.push(i);
  });

  /* ---------- TAB: Settings ---------- */
  const settingsTab = (
    <div className="card max-w-2xl p-5">
      <h2 className="card-title">Add-On Settings</h2>
      <form action={updateAddonSettings.bind(null, id)} className="space-y-3">
        <div>
          <label className="label-xs">Add-On Name</label>
          <input name="name" defaultValue={addon.name} required className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Client Facing Name</label>
          <input name="client_facing_name" defaultValue={addon.client_facing_name ?? ""} className="input w-full" placeholder="Blank uses the add-on name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-xs">Category</label>
            <select name="category_id" defaultValue={addon.category_id ?? ""} className="input w-full">
              <option value="">—</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Default Price ($)</label>
            <input type="number" step="0.01" name="default_price" defaultValue={addon.default_price} className="input w-full" />
          </div>
        </div>
        <div>
          <label className="label-xs">Description (shown on event fee details)</label>
          <textarea name="description" rows={4} defaultValue={addon.description ?? ""} className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Notes (internal)</label>
          <textarea name="notes" rows={2} defaultValue={addon.notes ?? ""} className="input w-full" />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label-xs">Display Order</label>
            <input type="number" name="display_order" defaultValue={addon.display_order} className="input w-24" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="commission_eligible" defaultChecked={addon.commission_eligible} className="size-4 accent-brand-light" />
            Commission eligible
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="is_active" defaultChecked={addon.is_active} className="size-4 accent-brand-light" />
            Active
          </label>
        </div>
        <VersionSaveButtons currentVersion={currentVersion} />
      </form>

      <div className="row mt-6 flex items-center justify-between pt-4">
        <span className="text-xs text-zinc-500">
          Used on {usedCount ?? 0} event{(usedCount ?? 0) === 1 ? "" : "s"}.
        </span>
        {(usedCount ?? 0) === 0 ? (
          <form action={deleteAddon.bind(null, id)}>
            <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
              Delete This Add-On
            </button>
          </form>
        ) : (
          <span className="text-xs text-zinc-500">In use — uncheck Active to retire it.</span>
        )}
      </div>
    </div>
  );

  /* ---------- TAB: Assigned Equipment ---------- */
  const equipmentTab = (
    <form action={saveAddonEquipmentDefaults.bind(null, id)}>
      <p className="mb-4 text-sm text-zinc-500">
        Equipment auto-added to the event&apos;s Logistics checklist whenever this add-on is attached to an event.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Assign Systems</h2>
          <div className="space-y-2">
            {(systems ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 rounded-lg bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.05]">
                <input type="checkbox" name={`system_${s.id}`} defaultChecked={systemAssigned.has(s.id)} className="size-4 accent-brand-light" />
                <span className="font-semibold">{s.name}</span>
                {s.description && <span className="text-xs text-zinc-500">{s.description}</span>}
              </label>
            ))}
            {(systems ?? []).length === 0 && <p className="text-sm text-zinc-500">No systems defined yet.</p>}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="card-title">Assign Stand Alone Equipment</h2>
          {[...itemsByCat.keys()].sort().map((cat) => (
            <div key={cat} className="mb-3">
              <div className="mb-1 flex items-center justify-between border-b border-zinc-200 pb-1 text-xs font-bold dark:border-white/10">
                <span>{cat}</span>
                <span className="text-zinc-500">Quantity</span>
              </div>
              {itemsByCat.get(cat)!.map((i) => (
                <div key={i.id} className="flex items-center justify-between py-1 text-sm">
                  <span>{i.name}</span>
                  <input type="number" min={0} name={`item_${i.id}`} defaultValue={itemQty.get(i.id) ?? ""} className="input w-16 py-1 text-center" />
                </div>
              ))}
            </div>
          ))}
          {(items ?? []).length === 0 && <p className="text-sm text-zinc-500">No standalone items yet.</p>}
        </div>
      </div>
      <SaveButton className="btn-primary mt-4">Save Assigned Equipment</SaveButton>
    </form>
  );

  /* ---------- TAB: Versions ---------- */
  const versionsTab = (
    <div className="card overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4 dark:border-white/[0.05]">
        <h2 className="card-title mb-1">Version History</h2>
        <p className="text-xs text-zinc-500">
          Events keep the version (price + description) they were sold with — changing this add-on never reprices
          past events. <strong>Create New Version</strong> starts a new entry; <strong>Update Current Version</strong>{" "}
          fixes the latest in place (typos).
        </p>
      </div>
      {(versions ?? []).map((v) => {
        const snap = v.snapshot as { name?: string; default_price?: number; description?: string | null };
        const pinned = pinCounts.get(v.version_no) ?? 0;
        return (
          <div key={v.version_no} className="flex items-start gap-4 border-t border-zinc-100 px-5 py-3 first:border-t-0 dark:border-white/[0.05]">
            <span
              className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${
                v.version_no === currentVersion
                  ? "bg-gradient-to-r from-brand to-brand-light text-white"
                  : "bg-black/[0.06] text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
              }`}
            >
              v{v.version_no}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {snap.name ?? addon.name}
                <span className="ml-2 font-normal text-zinc-500">{money(Number(snap.default_price ?? 0))}</span>
                {v.version_no === currentVersion && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">current</span>
                )}
              </div>
              {snap.description && <p className="mt-0.5 truncate text-xs text-zinc-500">{snap.description}</p>}
            </div>
            <div className="shrink-0 text-right text-xs text-zinc-400">
              <div>{new Date(v.created_at).toLocaleDateString()}</div>
              <div className={pinned > 0 ? "font-semibold text-zinc-600 dark:text-zinc-300" : ""}>
                {pinned} event{pinned === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        );
      })}
      {(versions ?? []).length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">
          No version history yet — run migration 00030, then every save records a version.
        </p>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <Link href="/packages" className="text-xs font-semibold text-zinc-500 hover:underline">← Packages &amp; Add-Ons</Link>
        <h1 className="page-title mt-1">
          {addon.name}
          {!addon.is_active && <span className="ml-2 text-sm font-normal text-zinc-500">(inactive)</span>}
        </h1>
        <p className="text-sm text-zinc-500">
          Add-On · {money(addon.default_price)}
          {addon.commission_eligible && " · commission eligible"}
        </p>
      </div>

      <Tabs
        tabs={[
          { id: "settings", label: "Settings", content: settingsTab },
          { id: "equipment", label: "Assigned Equipment", badge: (equipDefaults ?? []).length || undefined, content: equipmentTab },
          { id: "versions", label: "Versions", badge: `v${currentVersion}`, content: versionsTab },
        ]}
      />
    </div>
  );
}
