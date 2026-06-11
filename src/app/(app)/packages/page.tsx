import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import LiveFilter from "@/components/LiveFilter";
import SaveButton from "@/components/SaveButton";
import {
  createPackage,
  createPackageCategory,
  updatePackageCategory,
  deletePackageCategory,
  createAddon,
  createAddonCategory,
  updateAddonCategory,
  deleteAddonCategory,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ data: categories }, { data: packages }, { data: addons }, { data: datePrices }, { data: addonCategories }] =
    await Promise.all([
      supabase.from("package_categories").select("*").order("sort_order"),
      supabase.from("packages").select("*").order("display_order", { ascending: false }),
      supabase.from("addons").select("*").order("display_order"),
      supabase.from("package_date_prices").select("package_id"),
      supabase.from("addon_categories").select("*").order("sort_order"),
    ]);

  const pkgCatUsage = new Map<string, number>();
  (packages ?? []).forEach((p) => {
    if (p.category_id) pkgCatUsage.set(p.category_id, (pkgCatUsage.get(p.category_id) ?? 0) + 1);
  });
  const addonCatUsage = new Map<string, number>();
  (addons ?? []).forEach((a) => {
    if (a.category_id) addonCatUsage.set(a.category_id, (addonCatUsage.get(a.category_id) ?? 0) + 1);
  });
  const addonCatName = new Map((addonCategories ?? []).map((c) => [c.id, c.name]));

  const dateRuleCount = new Map<string, number>();
  (datePrices ?? []).forEach((p) => {
    dateRuleCount.set(p.package_id, (dateRuleCount.get(p.package_id) ?? 0) + 1);
  });

  const uncategorized = (packages ?? []).filter(
    (p) => !p.category_id || !(categories ?? []).some((c) => c.id === p.category_id)
  );

  function PackageTable({ pkgs }: { pkgs: NonNullable<typeof packages> }) {
    return (
      <div className="card overflow-x-auto rounded-t-none">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-right">Default Price</th>
              <th className="px-4 py-2 text-center">Hourly</th>
              <th className="px-4 py-2 text-right">Included Hours</th>
              <th className="px-4 py-2 text-right">OT / hr</th>
              <th className="px-4 py-2 text-right">Deposit</th>
              <th className="px-4 py-2 text-center">Date Pricing</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {pkgs.map((p) => (
              <tr key={p.id} data-searchable className={`row ${!p.is_active ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5 font-medium">
                  <Link href={`/packages/${p.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right">{money(p.default_price)}</td>
                <td className="px-4 py-2.5 text-center">{p.is_hourly ? `✓ ${money(p.hourly_rate)}/hr` : ""}</td>
                <td className="px-4 py-2.5 text-right">{p.included_hours || "—"}</td>
                <td className="px-4 py-2.5 text-right">{money(p.overtime_hourly)}</td>
                <td className="px-4 py-2.5 text-right">
                  {p.deposit_pct != null ? `${p.deposit_pct}%` : money(p.deposit_value)}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {(dateRuleCount.get(p.id) ?? 0) > 0 ? (
                    <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand/30 dark:text-brand-lighter">
                      {dateRuleCount.get(p.id)} rule{dateRuleCount.get(p.id) === 1 ? "" : "s"}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/packages/${p.id}`} className="btn-ghost px-3 py-1 text-xs">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="max-w-6xl" id="packages-root">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Packages &amp; Add-Ons</h1>
        <LiveFilter targetSelector="#packages-root" placeholder="Search packages and add-ons…" />
        <details className="relative">
          <summary className="btn-primary cursor-pointer list-none px-4 py-2 text-sm">+ Add Package</summary>
          <form
            action={createPackage}
            className="card absolute right-0 z-20 mt-2 w-72 space-y-2 bg-white/95 p-4 dark:bg-zinc-950/95"
          >
            <div>
              <label className="label-xs">Package Name</label>
              <input name="name" required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Category</label>
              <select name="category_id" className="input w-full">
                <option value="">—</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs">Default Price ($)</label>
              <input type="number" step="0.01" name="default_price" defaultValue={0} className="input w-full" />
            </div>
            <SaveButton className="btn-primary w-full py-2 text-xs" savedLabel="Added">Create &amp; Open Editor</SaveButton>
          </form>
        </details>
      </div>

      {(categories ?? []).map((cat) => {
        const pkgs = (packages ?? []).filter((p) => p.category_id === cat.id);
        if (pkgs.length === 0) return null;
        return (
          <div key={cat.id} className="mb-6" data-search-group>
            <h2 className="mb-0 rounded-t-xl bg-gradient-to-r from-brand to-brand-light px-4 py-2 text-sm font-bold uppercase tracking-wide text-white">
              {cat.name}
            </h2>
            <PackageTable pkgs={pkgs} />
          </div>
        );
      })}

      {uncategorized.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-0 rounded-t-xl bg-black/[0.07] px-4 py-2 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:bg-white/10 dark:text-white">
            Uncategorized
          </h2>
          <PackageTable pkgs={uncategorized} />
        </div>
      )}

      {/* ---------- ADD-ONS ---------- */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="mb-0 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-white">Add-Ons</h2>
        <details className="relative">
          <summary className="btn-ghost cursor-pointer list-none px-3 py-1.5 text-xs">+ Add Add-On</summary>
          <form
            action={createAddon}
            className="card absolute right-0 z-20 mt-2 w-72 space-y-2 bg-white/95 p-4 dark:bg-zinc-950/95"
          >
            <div>
              <label className="label-xs">Add-On Name</label>
              <input name="name" required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Category</label>
              <select name="category_id" className="input w-full">
                <option value="">—</option>
                {(addonCategories ?? []).filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs">Default Price ($)</label>
              <input type="number" step="0.01" name="default_price" defaultValue={0} className="input w-full" />
            </div>
            <SaveButton className="btn-primary w-full py-2 text-xs" savedLabel="Added">Create &amp; Open Editor</SaveButton>
          </form>
        </details>
      </div>
      <div className="card mt-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Add-On</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {(addons ?? []).map((a) => (
              <tr key={a.id} data-searchable className={`row ${!a.is_active ? "opacity-50" : ""}`}>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/addons/${a.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{(a.category_id && addonCatName.get(a.category_id)) ?? a.category ?? "—"}</td>
                <td className="px-4 py-2 text-right">{money(a.default_price)}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/addons/${a.id}`} className="btn-ghost px-3 py-1 text-xs">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- CATEGORY SETTINGS ---------- */}
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="card-title">Package Categories</h2>
          <div className="card mb-3 overflow-hidden">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {(categories ?? []).map((c) => (
                <li key={c.id} className={`px-4 py-2 ${c.is_active === false ? "opacity-50" : ""}`}>
                  <form action={updatePackageCategory.bind(null, c.id)} className="flex items-center gap-2 text-sm">
                    <input name="name" defaultValue={c.name} className="input w-full py-1.5" />
                    <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                      <input type="checkbox" name="is_active" defaultChecked={c.is_active !== false} className="size-3.5 accent-brand-light" />
                      active
                    </label>
                    <span className="shrink-0 text-xs text-zinc-500">{pkgCatUsage.get(c.id) ?? 0} pkg</span>
                    <button className="btn-ghost shrink-0 px-2.5 py-1 text-xs">Save</button>
                    {(pkgCatUsage.get(c.id) ?? 0) === 0 && (
                      <button formAction={deletePackageCategory.bind(null, c.id)} className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                        ✕
                      </button>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          </div>
          <form action={createPackageCategory.bind(null, null)} className="card flex items-end gap-2 p-3">
            <div className="flex-1">
              <label className="label-xs">New Package Category</label>
              <input name="name" required className="input w-full py-1.5" />
            </div>
            <SaveButton className="btn-primary px-4 py-2 text-xs" savedLabel="Added">Add</SaveButton>
          </form>
        </div>

        <div>
          <h2 className="card-title">Add-On Categories</h2>
          <div className="card mb-3 overflow-hidden">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {(addonCategories ?? []).map((c) => (
                <li key={c.id} className={`px-4 py-2 ${!c.is_active ? "opacity-50" : ""}`}>
                  <form action={updateAddonCategory.bind(null, c.id)} className="flex items-center gap-2 text-sm">
                    <input name="name" defaultValue={c.name} className="input w-full py-1.5" />
                    <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                      <input type="checkbox" name="is_active" defaultChecked={c.is_active} className="size-3.5 accent-brand-light" />
                      active
                    </label>
                    <span className="shrink-0 text-xs text-zinc-500">{addonCatUsage.get(c.id) ?? 0} add-ons</span>
                    <button className="btn-ghost shrink-0 px-2.5 py-1 text-xs">Save</button>
                    {(addonCatUsage.get(c.id) ?? 0) === 0 && (
                      <button formAction={deleteAddonCategory.bind(null, c.id)} className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                        ✕
                      </button>
                    )}
                  </form>
                </li>
              ))}
              {(addonCategories ?? []).length === 0 && (
                <li className="px-4 py-3 text-sm text-zinc-500">No add-on categories yet — run migration 00018.</li>
              )}
            </ul>
          </div>
          <form action={createAddonCategory} className="card flex items-end gap-2 p-3">
            <div className="flex-1">
              <label className="label-xs">New Add-On Category</label>
              <input name="name" required className="input w-full py-1.5" />
            </div>
            <SaveButton className="btn-primary px-4 py-2 text-xs" savedLabel="Added">Add</SaveButton>
          </form>
        </div>
      </div>
    </div>
  );
}
