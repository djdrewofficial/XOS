import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { updatePackageFinancials } from "./actions";

export const dynamic = "force-dynamic";

const SPLIT_OPTIONS = [1, 2, 3, 4, 5, 6];

export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ data: categories }, { data: packages }, { data: addons }] = await Promise.all([
    supabase.from("package_categories").select("*").order("sort_order"),
    supabase.from("packages").select("*").order("display_order"),
    supabase.from("addons").select("*").order("display_order"),
  ]);

  return (
    <div className="max-w-5xl">
      <h1 className="mb-5 text-2xl font-bold">Packages & Add-Ons</h1>

      {(categories ?? []).map((cat) => {
        const pkgs = (packages ?? []).filter((p) => p.category_id === cat.id);
        if (pkgs.length === 0) return null;
        return (
          <div key={cat.id} className="mb-6">
            <h2 className="mb-2 rounded-t-xl bg-gradient-to-r from-violet-600/70 to-fuchsia-600/50 px-4 py-2 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-white">
              {cat.name}
            </h2>
            <div className="card overflow-hidden rounded-t-none">
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-2">Package</th>
                    <th className="px-4 py-2 text-right">Default Price</th>
                    <th className="px-4 py-2 text-right">Included Hours</th>
                    <th className="px-4 py-2 text-right">OT / hr</th>
                    <th className="px-4 py-2 text-right">OT / half hr</th>
                    <th className="px-4 py-2 text-right">Hourly Rate</th>
                    <th className="px-4 py-2 text-right">Deposit</th>
                  </tr>
                </thead>
                <tbody>
                  {pkgs.map((p) => (
                    <>
                      <tr key={p.id} className="row">
                        <td className="px-4 py-2 font-medium">{p.name}</td>
                        <td className="px-4 py-2 text-right">{money(p.default_price)}</td>
                        <td className="px-4 py-2 text-right">{p.included_hours || "—"}</td>
                        <td className="px-4 py-2 text-right">{money(p.overtime_hourly)}</td>
                        <td className="px-4 py-2 text-right">{money(p.overtime_half_hourly)}</td>
                        <td className="px-4 py-2 text-right">{p.is_hourly ? money(p.hourly_rate) : "—"}</td>
                        <td className="px-4 py-2 text-right">{money(p.deposit_value)}</td>
                      </tr>
                      <tr key={`${p.id}-rules`} className="bg-black/[0.02] dark:bg-white/[0.02]">
                        <td colSpan={7} className="px-4 pt-1 pb-3">
                          <form
                            action={updatePackageFinancials.bind(null, p.id)}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
                          >
                            <span className="font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                              Payment Rules
                            </span>
                            <span className="flex items-center gap-2.5">
                              {SPLIT_OPTIONS.map((n) => (
                                <label key={n} className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                                  <input
                                    type="checkbox"
                                    name="allowed_splits"
                                    value={n}
                                    defaultChecked={(p.allowed_splits ?? [1, 2, 3]).includes(n)}
                                    className="size-3.5 accent-brand-light"
                                  />
                                  {n === 1 ? "Full" : `${n} splits`}
                                </label>
                              ))}
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                              Balance due
                              <input
                                type="number"
                                name="payment_terms_days"
                                defaultValue={p.payment_terms_days ?? 30}
                                className="input w-16 py-1 text-center"
                              />
                              days
                              <select
                                name="payment_terms"
                                defaultValue={p.payment_terms ?? "days_before"}
                                className="input py-1"
                              >
                                <option value="days_before">before event</option>
                                <option value="net_days_after">after event (Net)</option>
                              </select>
                            </span>
                            <button className="btn-ghost px-3 py-1 text-[11px]">Save Rules</button>
                          </form>
                        </td>
                      </tr>
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <h2 className="mb-2 rounded-t-xl bg-black/[0.07] dark:bg-white/10 px-4 py-2 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-white">
        Add-Ons
      </h2>
      <div className="card overflow-hidden rounded-t-none">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Add-On</th>
              <th className="px-4 py-2">Category</th>
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
      <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
        Beta 1: package/add-on editing happens in Supabase. CRUD UI lands in Beta 2.
      </p>
    </div>
  );
}
