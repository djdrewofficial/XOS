import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import VendorsDirectory from "@/components/VendorsDirectory";
import SaveButton from "@/components/SaveButton";
import { createVendor, createVendorCategory, toggleVendorCategory } from "./actions";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const supabase = await createClient();
  const [{ data: vendors }, { data: categories }, { data: contacts }, { data: links }, { count: reviewCount }] = await Promise.all([
    supabase.from("vendors").select("*").order("company_name"),
    supabase.from("vendor_categories").select("*").order("name"),
    supabase.from("vendor_contacts").select("vendor_id"),
    supabase.from("event_vendors").select("vendor_id"),
    supabase.from("vendor_match_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
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
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="page-title">Vendors</h1>
        <Link
          href="/vendors/review"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/5"
        >
          Review queue
          {reviewCount ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{reviewCount}</span> : null}
        </Link>
      </div>

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
        <SaveButton savedLabel="Added">Add Category</SaveButton>
      </form>
    </div>
  );
}
