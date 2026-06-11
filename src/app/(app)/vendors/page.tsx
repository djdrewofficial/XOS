import { createClient } from "@/lib/supabase/server";
import VendorsDirectory from "@/components/VendorsDirectory";
import { createVendor, createVendorCategory, toggleVendorCategory } from "./actions";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const supabase = await createClient();
  const [{ data: vendors }, { data: categories }, { data: contacts }, { data: links }] = await Promise.all([
    supabase.from("vendors").select("*").order("company_name"),
    supabase.from("vendor_categories").select("*").order("name"),
    supabase.from("vendor_contacts").select("vendor_id"),
    supabase.from("event_vendors").select("vendor_id"),
  ]);

  const contactCounts: Record<string, number> = {};
  (contacts ?? []).forEach((c) => {
    contactCounts[c.vendor_id] = (contactCounts[c.vendor_id] ?? 0) + 1;
  });
  const eventCounts: Record<string, number> = {};
  (links ?? []).forEach((l) => {
    eventCounts[l.vendor_id] = (eventCounts[l.vendor_id] ?? 0) + 1;
  });
  const categoryUsage: Record<string, number> = {};
  (vendors ?? []).forEach((v) => {
    if (v.category_id) categoryUsage[v.category_id] = (categoryUsage[v.category_id] ?? 0) + 1;
  });

  return (
    <div className="max-w-6xl">
      <h1 className="page-title mb-5">Vendors</h1>

      <VendorsDirectory
        vendors={vendors ?? []}
        categories={categories ?? []}
        contactCounts={contactCounts}
        eventCounts={eventCounts}
        createVendor={createVendor}
      />

      {/* ---------- VENDOR SETTINGS: CATEGORIES ---------- */}
      <h2 className="card-title mt-10">Vendor Categories</h2>
      <div className="card mb-3 overflow-hidden">
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(categories ?? []).map((c) => (
            <li key={c.id} className={`flex items-center justify-between px-4 py-2.5 text-sm ${!c.is_active ? "opacity-50" : ""}`}>
              <span>
                <span className="font-semibold">{c.name}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {categoryUsage[c.id] ?? 0} vendor{(categoryUsage[c.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
              <form action={toggleVendorCategory.bind(null, c.id, !c.is_active)}>
                <button className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
                  {c.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </li>
          ))}
          {(categories ?? []).length === 0 && (
            <li className="px-4 py-4 text-sm text-zinc-500">No categories yet — run migration 00014.</li>
          )}
        </ul>
      </div>
      <form action={createVendorCategory} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-52 flex-1">
          <label className="label-xs">New Category</label>
          <input name="name" required className="input w-full" placeholder="e.g. Live Musicians" />
        </div>
        <button className="btn-primary">Add Category</button>
      </form>
    </div>
  );
}
