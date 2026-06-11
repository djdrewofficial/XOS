import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createVendor } from "./actions";

export const dynamic = "force-dynamic";

const VENDOR_CATEGORIES = [
  "Photographer", "Videographer", "Wedding Planner", "Florist", "Caterer",
  "Venue Coordinator", "Cake / Bakery", "Hair & Makeup", "Officiant", "Rentals", "Other",
];

export default async function VendorsPage() {
  const supabase = await createClient();
  const [{ data: vendors }, { data: contacts }, { data: links }] = await Promise.all([
    supabase.from("vendors").select("*").order("company_name"),
    supabase.from("vendor_contacts").select("vendor_id"),
    supabase.from("event_vendors").select("vendor_id"),
  ]);

  const contactCount = new Map<string, number>();
  (contacts ?? []).forEach((c) => contactCount.set(c.vendor_id, (contactCount.get(c.vendor_id) ?? 0) + 1));
  const eventCount = new Map<string, number>();
  (links ?? []).forEach((l) => eventCount.set(l.vendor_id, (eventCount.get(l.vendor_id) ?? 0) + 1));

  return (
    <div className="max-w-5xl">
      <h1 className="page-title mb-5">Vendors</h1>

      <div className="card mb-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Company</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-center">Contacts</th>
              <th className="px-4 py-2 text-center">Events Together</th>
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(vendors ?? []).map((v) => (
              <tr key={v.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/vendors/${v.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {v.company_name}
                  </Link>
                </td>
                <td className="px-4 py-2">{v.category ?? "—"}</td>
                <td className="px-4 py-2 text-center">{contactCount.get(v.id) ?? 0}</td>
                <td className="px-4 py-2 text-center font-semibold">{eventCount.get(v.id) ?? 0}</td>
                <td className="max-w-xs truncate px-4 py-2 text-zinc-500">{v.notes ?? ""}</td>
              </tr>
            ))}
            {(vendors ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No vendors yet — add the people you work with below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="card-title">Add Vendor</h2>
      <form action={createVendor} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-52 flex-1">
          <label className="label-xs">Company / Vendor Name</label>
          <input name="company_name" required className="input w-full" placeholder="Photography by Sasha" />
        </div>
        <div className="min-w-44">
          <label className="label-xs">Category</label>
          <input name="category" list="vendor-categories" className="input w-full" />
          <datalist id="vendor-categories">
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="min-w-52 flex-1">
          <label className="label-xs">Notes</label>
          <input name="notes" className="input w-full" />
        </div>
        <button className="btn-primary">Add Vendor</button>
      </form>
    </div>
  );
}
