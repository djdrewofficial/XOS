"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Vendor = {
  id: string;
  company_name: string;
  category_id: string | null;
  is_preferred: boolean;
  website: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  social_collab: string | null;
  notes: string | null;
};

type Category = { id: string; name: string; is_active: boolean };

const COLLAB_LABEL: Record<string, string> = {
  collab: "Invite to Collab",
  tag: "Just Tag",
  either: "Either",
  none: "No Tag or Collab",
};

export default function VendorsDirectory({
  vendors,
  categories,
  contactCounts,
  eventCounts,
  createVendor,
}: {
  vendors: Vendor[];
  categories: Category[];
  contactCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  createVendor: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const activeCategories = categories.filter((c) => c.is_active);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => {
      if (preferredOnly && !v.is_preferred) return false;
      if (categoryFilter && v.category_id !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        v.company_name,
        v.category_id ? catName.get(v.category_id) : "",
        v.notes,
        v.website,
        v.instagram,
        v.tiktok,
        v.youtube,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vendors, query, categoryFilter, preferredOnly, catName]);

  return (
    <div>
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendors by name, category, socials…"
          className="input min-w-64 flex-1 px-4 py-2.5"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input py-2.5">
          <option value="">All categories</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={preferredOnly}
            onChange={(e) => setPreferredOnly(e.target.checked)}
            className="size-4 accent-brand-light"
          />
          ★ preferred only
        </label>
        <span className="text-xs text-zinc-500">{filtered.length} vendors</span>
        <button onClick={() => setAddOpen(true)} className="btn-primary px-4 py-2 text-sm">
          + Add Vendor
        </button>
      </div>

      {/* table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Company</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-left">Socials</th>
              <th className="px-4 py-2 text-left">Social Posts</th>
              <th className="px-4 py-2 text-center">Contacts</th>
              <th className="px-4 py-2 text-center">Events</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr
                key={v.id}
                onClick={() => router.push(`/vendors/${v.id}`)}
                className="row cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <td className="px-4 py-2.5 font-semibold text-brand dark:text-brand-lighter">
                  {v.is_preferred && <span className="mr-1.5 text-amber-500" title="Preferred Vendor">★</span>}
                  {v.company_name}
                </td>
                <td className="px-4 py-2.5">
                  {v.category_id && catName.get(v.category_id) ? (
                    <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand/30 dark:text-brand-lighter">
                      {catName.get(v.category_id)}
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex gap-2 text-xs font-semibold" onClick={(e) => e.stopPropagation()}>
                    {v.website && <a href={v.website} target="_blank" className="text-zinc-500 hover:text-brand dark:hover:text-brand-lighter" title="Website">🌐</a>}
                    {v.instagram && <a href={`https://instagram.com/${v.instagram.replace(/^@/, "")}`} target="_blank" className="text-zinc-500 hover:text-brand dark:hover:text-brand-lighter" title={`IG ${v.instagram}`}>IG</a>}
                    {v.tiktok && <a href={`https://tiktok.com/@${v.tiktok.replace(/^@/, "")}`} target="_blank" className="text-zinc-500 hover:text-brand dark:hover:text-brand-lighter" title={`TikTok ${v.tiktok}`}>TT</a>}
                    {v.youtube && <a href={v.youtube.startsWith("http") ? v.youtube : `https://youtube.com/${v.youtube}`} target="_blank" className="text-zinc-500 hover:text-brand dark:hover:text-brand-lighter" title="YouTube">YT</a>}
                    {!v.website && !v.instagram && !v.tiktok && !v.youtube && <span className="text-zinc-400">—</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {v.social_collab ? (
                    <span className="rounded bg-black/[0.06] px-2 py-0.5 font-semibold text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300">
                      {COLLAB_LABEL[v.social_collab]}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">{contactCounts[v.id] ?? 0}</td>
                <td className="px-4 py-2.5 text-center font-semibold">{eventCounts[v.id] ?? 0}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">No vendors match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* add vendor modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setAddOpen(false)}>
          <div className="card max-h-[90vh] w-full max-w-xl overflow-y-auto bg-white/95 p-6 dark:bg-zinc-950/95" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Add Vendor</h2>
              <button onClick={() => setAddOpen(false)} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-black/10 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">✕</button>
            </div>
            <form action={createVendor} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-xs">Company / Vendor Name</label>
                <input name="company_name" required autoFocus className="input w-full" placeholder="Photography by Sasha" />
              </div>
              <div>
                <label className="label-xs">Category</label>
                <select name="category_id" className="input w-full">
                  <option value="">—</option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" name="is_preferred" className="size-4 accent-brand-light" />
                ★ Preferred Vendor
              </label>
              <div>
                <label className="label-xs">Website</label>
                <input name="website" className="input w-full" placeholder="https://…" />
              </div>
              <div>
                <label className="label-xs">Instagram</label>
                <input name="instagram" className="input w-full" placeholder="@handle" />
              </div>
              <div>
                <label className="label-xs">TikTok</label>
                <input name="tiktok" className="input w-full" placeholder="@handle" />
              </div>
              <div>
                <label className="label-xs">YouTube</label>
                <input name="youtube" className="input w-full" placeholder="@channel or URL" />
              </div>
              <div className="col-span-2">
                <label className="label-xs">When We Post About Shared Events</label>
                <select name="social_collab" className="input w-full">
                  <option value="">—</option>
                  <option value="collab">Invite to Collab</option>
                  <option value="tag">Just Tag</option>
                  <option value="either">Either</option>
                  <option value="none">No Tag or Collab</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label-xs">Notes</label>
                <input name="notes" className="input w-full" />
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAddOpen(false)} className="btn-ghost px-4 py-2 text-xs">Cancel</button>
                <button className="btn-primary px-5 py-2 text-xs">Create Vendor</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
