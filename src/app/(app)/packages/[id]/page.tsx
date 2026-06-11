import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import Tabs from "@/components/Tabs";
import {
  updatePackageGeneral,
  updatePackageFinancials,
  createPackageCategory,
  addDatePrice,
  deleteDatePrice,
  saveAddonDefaults,
  saveEquipmentDefaults,
} from "../actions";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SPLIT_OPTIONS = [1, 2, 3, 4, 5, 6];

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: pkg },
    { data: categories },
    { data: datePrices },
    { data: addonDefaults },
    { data: equipDefaults },
    { data: addons },
    { data: items },
    { data: systems },
  ] = await Promise.all([
    supabase.from("packages").select("*").eq("id", id).single(),
    supabase.from("package_categories").select("*").order("sort_order"),
    supabase.from("package_date_prices").select("*").eq("package_id", id).order("start_date"),
    supabase.from("package_addon_defaults").select("*").eq("package_id", id),
    supabase.from("package_equipment_defaults").select("*").eq("package_id", id),
    supabase.from("addons").select("*").eq("is_active", true).order("name"),
    supabase.from("equipment_items").select("*").eq("is_active", true).is("system_id", null).order("name"),
    supabase.from("equipment_systems").select("*").eq("is_active", true).order("name"),
  ]);

  if (!pkg) notFound();

  const weekday = (pkg.weekday_prices as Record<string, number> | null) ?? {};
  const addonQty = new Map((addonDefaults ?? []).map((a) => [a.addon_id, a.quantity]));
  const systemAssigned = new Set((equipDefaults ?? []).filter((e) => e.system_id).map((e) => e.system_id));
  const itemQty = new Map((equipDefaults ?? []).filter((e) => e.item_id).map((e) => [e.item_id, e.quantity]));

  // standalone items grouped by category
  const itemsByCat = new Map<string, NonNullable<typeof items>>();
  (items ?? []).forEach((i) => {
    const cat = i.category?.trim() || "Uncategorized";
    if (!itemsByCat.has(cat)) itemsByCat.set(cat, []);
    itemsByCat.get(cat)!.push(i);
  });

  // addons grouped by category
  const addonsByCat = new Map<string, NonNullable<typeof addons>>();
  (addons ?? []).forEach((a) => {
    const cat = a.category?.trim() || "Not Categorized";
    if (!addonsByCat.has(cat)) addonsByCat.set(cat, []);
    addonsByCat.get(cat)!.push(a);
  });

  /* ---------- TAB: General ---------- */
  const generalTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Package Details</h2>
        <form action={updatePackageGeneral.bind(null, id)} className="space-y-3">
          <div>
            <label className="label-xs">Package Name</label>
            <input name="name" defaultValue={pkg.name} required className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Client Facing Name</label>
            <input name="client_facing_name" defaultValue={pkg.client_facing_name ?? ""} className="input w-full" placeholder="Shown to clients — blank uses the package name" />
          </div>
          <div>
            <label className="label-xs">Category</label>
            <select name="category_id" defaultValue={pkg.category_id ?? ""} className="input w-full">
              <option value="">—</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Description (shown on event fee details)</label>
            <textarea name="description" rows={6} defaultValue={pkg.description ?? ""} className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Notes (internal)</label>
            <textarea name="notes" rows={2} defaultValue={pkg.notes ?? ""} className="input w-full" />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="label-xs">Display Order</label>
              <input type="number" name="display_order" defaultValue={pkg.display_order} className="input w-24" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="is_active" defaultChecked={pkg.is_active} className="size-4 accent-brand-light" />
              Active
            </label>
          </div>
          <button className="btn-primary">Save</button>
        </form>
      </div>

      <div className="card h-fit p-5">
        <h2 className="card-title">New Category</h2>
        <form action={createPackageCategory.bind(null, id)} className="flex gap-2">
          <input name="name" required placeholder="Category name" className="input w-full" />
          <button className="btn-ghost px-4 py-1.5 text-xs">Add</button>
        </form>
      </div>
    </div>
  );

  /* ---------- TAB: Financials ---------- */
  const financialsTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Financial Settings</h2>
          <p className="mb-3 text-xs text-zinc-500">Changing these will NOT affect previously saved events.</p>
          <form action={updatePackageFinancials.bind(null, id)} className="space-y-3">
            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" name="is_taxable" defaultChecked={pkg.is_taxable} className="size-4 accent-brand-light" />
                Taxable
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" name="is_hourly" defaultChecked={pkg.is_hourly} className="size-4 accent-brand-light" />
                Hourly rate structure
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-xs">Default Price ($)</label>
                <input type="number" step="0.01" name="default_price" defaultValue={pkg.default_price} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Hourly Rate ($, if hourly)</label>
                <input type="number" step="0.01" name="hourly_rate" defaultValue={pkg.hourly_rate} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Included Hours</label>
                <input type="number" step="0.5" name="included_hours" defaultValue={pkg.included_hours} className="input w-full" />
              </div>
              <div />
              <div>
                <label className="label-xs">Overtime / Hour ($)</label>
                <input type="number" step="0.01" name="overtime_hourly" defaultValue={pkg.overtime_hourly} className="input w-full" />
              </div>
              <div>
                <label className="label-xs">Overtime / Half Hour ($)</label>
                <input type="number" step="0.01" name="overtime_half_hourly" defaultValue={pkg.overtime_half_hourly} className="input w-full" />
              </div>
            </div>

            <h3 className="label-xs pt-2">Default Deposit</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="radio" name="deposit_mode" value="fixed" defaultChecked={pkg.deposit_pct == null} className="accent-brand-light" />
                Fixed: $
                <input type="number" step="0.01" name="deposit_value" defaultValue={pkg.deposit_value} className="input w-28 py-1.5" />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="radio" name="deposit_mode" value="pct" defaultChecked={pkg.deposit_pct != null} className="accent-brand-light" />
                Percentage:
                <input type="number" step="0.1" name="deposit_pct" defaultValue={pkg.deposit_pct ?? ""} className="input w-20 py-1.5" />
                %
              </label>
            </div>

            <h3 className="label-xs pt-2">Weekday Pricing (optional — blank uses default price)</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAYS.map((day, i) => (
                <div key={day}>
                  <label className="label-xs">{day}</label>
                  <input
                    type="number"
                    step="0.01"
                    name={`weekday_${i}`}
                    defaultValue={weekday[String(i)] ?? ""}
                    placeholder="—"
                    className="input w-full py-1.5"
                  />
                </div>
              ))}
            </div>

            <h3 className="label-xs pt-2">Payment Rules</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              {SPLIT_OPTIONS.map((n) => (
                <label key={n} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="allowed_splits"
                    value={n}
                    defaultChecked={(pkg.allowed_splits ?? [1, 2, 3]).includes(n)}
                    className="size-4 accent-brand-light"
                  />
                  {n === 1 ? "Full" : `${n} splits`}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              Balance due
              <input type="number" name="payment_terms_days" defaultValue={pkg.payment_terms_days ?? 30} className="input w-16 py-1 text-center" />
              days
              <select name="payment_terms" defaultValue={pkg.payment_terms ?? "days_before"} className="input py-1">
                <option value="days_before">before event</option>
                <option value="net_days_after">after event (Net)</option>
              </select>
            </div>

            <button className="btn-primary">Save Financials</button>
          </form>
        </div>

        <div className="card h-fit p-5">
          <h2 className="card-title">Custom Date Range Pricing</h2>
          <p className="mb-3 text-xs text-zinc-500">
            <strong>Overrules everything</strong> — weekday pricing and the default price — when an event date
            falls in a range. Applied when the package is selected on an event.
          </p>
          <ul className="mb-4 divide-y divide-zinc-100 dark:divide-white/[0.06]">
            {(datePrices ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-semibold">{p.label ?? "Date range"}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {p.start_date}{p.end_date !== p.start_date && ` → ${p.end_date}`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-bold">{money(p.price)}</span>
                  <form action={deleteDatePrice.bind(null, id, p.id)}>
                    <button className="text-xs text-red-600 dark:text-red-400 hover:underline">✕</button>
                  </form>
                </span>
              </li>
            ))}
            {(datePrices ?? []).length === 0 && (
              <li className="py-2 text-sm text-zinc-500">No date range pricing — e.g. add NYE at a premium.</li>
            )}
          </ul>
          <form action={addDatePrice.bind(null, id)} className="grid grid-cols-2 gap-2">
            <input name="label" placeholder='Label (e.g. "NYE 2026")' className="input col-span-2" />
            <div>
              <label className="label-xs">Start</label>
              <input type="date" name="start_date" required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">End</label>
              <input type="date" name="end_date" className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Price ($)</label>
              <input type="number" step="0.01" name="price" required className="input w-full" />
            </div>
            <div className="flex items-end">
              <button className="btn-primary w-full py-2 text-xs">Add Range</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  /* ---------- TAB: Assigned Equipment ---------- */
  const equipmentTab = (
    <form action={saveEquipmentDefaults.bind(null, id)}>
      <p className="mb-4 text-sm text-zinc-500">
        Equipment auto-added to the event&apos;s Logistics checklist when this package is selected.
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
                  <input type="number" min={0} name={`item_${i.id}`} defaultValue={itemQty.get(i.id) ?? ""} placeholder="" className="input w-16 py-1 text-center" />
                </div>
              ))}
            </div>
          ))}
          {(items ?? []).length === 0 && <p className="text-sm text-zinc-500">No standalone items yet.</p>}
        </div>
      </div>
      <button className="btn-primary mt-4">Save Assigned Equipment</button>
    </form>
  );

  /* ---------- TAB: Assigned Add-Ons ---------- */
  const addonsTab = (
    <form action={saveAddonDefaults.bind(null, id)}>
      <p className="mb-4 text-sm text-zinc-500">
        These add-ons are automatically attached (with quantity) when this package is first assigned on an event.
      </p>
      <div className="card max-w-2xl p-5">
        {[...addonsByCat.keys()].sort().map((cat) => (
          <div key={cat} className="mb-4">
            <div className="mb-1 flex items-center justify-between border-b border-zinc-200 pb-1 text-xs font-bold dark:border-white/10">
              <span>{cat}</span>
              <span className="text-zinc-500">Quantity</span>
            </div>
            {addonsByCat.get(cat)!.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>
                  {a.name} <span className="text-xs text-zinc-500">— {money(a.default_price)}</span>
                </span>
                <input type="number" min={0} name={`addon_${a.id}`} defaultValue={addonQty.get(a.id) ?? ""} placeholder="" className="input w-16 py-1 text-center" />
              </div>
            ))}
          </div>
        ))}
        {(addons ?? []).length === 0 && <p className="text-sm text-zinc-500">No add-ons defined yet.</p>}
      </div>
      <button className="btn-primary mt-4">Save Assigned Add-Ons</button>
    </form>
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <Link href="/packages" className="text-xs font-semibold text-zinc-500 hover:underline">← All Packages</Link>
        <h1 className="page-title mt-1">
          {pkg.name}
          {!pkg.is_active && <span className="ml-2 text-sm font-normal text-zinc-500">(inactive)</span>}
        </h1>
        <p className="text-sm text-zinc-500">
          {(categories ?? []).find((c) => c.id === pkg.category_id)?.name ?? "Uncategorized"} ·{" "}
          {pkg.is_hourly ? `${money(pkg.hourly_rate)}/hr` : money(pkg.default_price)}
        </p>
      </div>

      <Tabs
        tabs={[
          { id: "general", label: "General", content: generalTab },
          { id: "financials", label: "Financials", badge: (datePrices ?? []).length ? `${(datePrices ?? []).length} date rules` : undefined, content: financialsTab },
          { id: "equipment", label: "Assigned Equipment", badge: (equipDefaults ?? []).length || undefined, content: equipmentTab },
          { id: "addons", label: "Assigned Add-Ons", badge: (addonDefaults ?? []).length || undefined, content: addonsTab },
        ]}
      />
    </div>
  );
}
