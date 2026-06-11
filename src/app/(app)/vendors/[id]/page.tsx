import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateVendor, addVendorContact, removeVendorContact } from "../actions";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: vendor }, { data: contacts }, { data: links }] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).single(),
    supabase.from("vendor_contacts").select("*").eq("vendor_id", id).order("name"),
    supabase
      .from("event_vendors")
      .select("*, event:events(id, name, event_date, status:event_statuses(name, color, text_color), venue:venues(name))")
      .eq("vendor_id", id),
  ]);

  if (!vendor) notFound();

  type LinkRow = {
    id: string;
    role: string;
    event: {
      id: string;
      name: string;
      event_date: string | null;
      status: { name: string; color: string; text_color: string } | null;
      venue: { name: string } | null;
    } | null;
  };
  const linkRows = ((links ?? []) as unknown as LinkRow[])
    .filter((l) => l.event)
    .sort((a, b) => (b.event!.event_date ?? "").localeCompare(a.event!.event_date ?? ""));

  const today = new Date().toISOString().slice(0, 10);
  const worked = linkRows.filter((l) => l.event!.event_date && l.event!.event_date < today).length;
  const upcoming = linkRows.filter((l) => l.event!.event_date && l.event!.event_date >= today).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{vendor.company_name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{vendor.category ?? "Vendor"}</p>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="card px-3 py-1.5">
            <span className="font-bold">{worked}</span>{" "}
            <span className="text-zinc-500">events together</span>
          </span>
          <span className="card px-3 py-1.5">
            <span className="font-bold">{upcoming}</span>{" "}
            <span className="text-zinc-500">upcoming</span>
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Vendor Details</h2>
          <form action={updateVendor.bind(null, id)} className="space-y-3">
            <div>
              <label className="label-xs">Company / Vendor Name</label>
              <input name="company_name" defaultValue={vendor.company_name} required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Category</label>
              <input name="category" defaultValue={vendor.category ?? ""} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Notes</label>
              <textarea name="notes" rows={3} defaultValue={vendor.notes ?? ""} className="input w-full" />
            </div>
            <button className="btn-primary">Save Vendor</button>
          </form>
        </div>

        <div className="card p-5">
          <h2 className="card-title">People At {vendor.company_name}</h2>
          <ul className="mb-3 space-y-2 text-sm">
            {(contacts ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
                <span>
                  <span className="font-semibold">{c.name}</span>
                  {c.role && <span className="ml-2 text-xs text-zinc-500">{c.role}</span>}
                  <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <form action={removeVendorContact.bind(null, id, c.id)}>
                  <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>
                </form>
              </li>
            ))}
            {(contacts ?? []).length === 0 && <li className="text-xs text-zinc-500">No contacts yet.</li>}
          </ul>
          <form action={addVendorContact.bind(null, id)} className="grid grid-cols-2 gap-2">
            <input name="name" placeholder="Name" required className="input" />
            <input name="role" placeholder="Role (e.g. Lead Photographer)" className="input" />
            <input name="phone" placeholder="Phone" className="input" />
            <input name="email" placeholder="Email" className="input" />
            <div className="col-span-2">
              <button className="btn-ghost px-4 py-1.5 text-xs">Add Contact</button>
            </div>
          </form>
        </div>
      </div>

      <h2 className="card-title mt-6">Events Worked Together</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Their Role</th>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {linkRows.map((l) => (
              <tr key={l.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 whitespace-nowrap">{l.event!.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${l.event!.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
                    {l.event!.name || "(unnamed)"}
                  </Link>
                </td>
                <td className="px-4 py-2">{l.role}</td>
                <td className="px-4 py-2">{l.event!.venue?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  {l.event!.status && (
                    <span className="chip" style={{ backgroundColor: l.event!.status.color, color: l.event!.status.text_color }}>
                      {l.event!.status.name}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {linkRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No shared events yet — add this vendor to an event from the event&apos;s Vendors tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
