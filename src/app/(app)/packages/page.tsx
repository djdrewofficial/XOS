import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { createPackage } from "./actions";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ data: categories }, { data: packages }, { data: addons }, { data: datePrices }] = await Promise.all([
    supabase.from("package_categories").select("*").order("sort_order"),
    supabase.from("packages").select("*").order("display_order", { ascending: false }),
    supabase.from("addons").select("*").order("display_order"),
    supabase.from("package_date_prices").select("package_id"),
  ]);

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
              <tr key={p.id} className={`row ${!p.is_active ? "opacity-50" : ""}`}>
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
    <div className="max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="page-title">Packages &amp; Add-Ons</h1>
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
            <button className="btn-primary w-full py-2 text-xs">Create &amp; Open Editor</button>
          </form>
        </details>
      </div>

      {(categories ?? []).map((cat) => {
        const pkgs = (packages ?? []).filter((p) => p.category_id === cat.id);
        if (pkgs.length === 0) return null;
        return (
          <div key={cat.id} className="mb-6">
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

      <h2 className="mb-0 mt-8 rounded-t-xl bg-black/[0.07] px-4 py-2 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:bg-white/10 dark:text-white">
        Add-Ons
      </h2>
      <div className="card overflow-hidden rounded-t-none">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Add-On</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {(addons ?? []).map((a) => (
              <tr key={a.id} className="row">
                <td className="px-4 py-2 font-medium">{a.name}</td>
                <td className="px-4 py-2">{a.category ?? "—"}</td>
                <td className="px-4 py-2 text-right">{money(a.default_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
