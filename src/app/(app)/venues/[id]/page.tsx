import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money, type XEvent } from "@/lib/types";
import { updateVenue, addVenueContact, removeVenueContact, addVenueRoom } from "../actions";

export const dynamic = "force-dynamic";

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: venue }, { data: contacts }, { data: rooms }, { data: categories }, { data: events }] = await Promise.all([
    supabase.from("venues").select("*").eq("id", id).single(),
    supabase.from("venue_contacts").select("*").eq("venue_id", id).order("name"),
    supabase.from("venue_rooms").select("*").eq("venue_id", id).order("name"),
    supabase.from("venue_categories").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("events")
      .select("*, client:clients(first_name, last_name), status:event_statuses(name, color, text_color)")
      .eq("venue_id", id)
      .order("event_date", { ascending: false })
      .limit(50),
  ]);

  if (!venue) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const timesWorked = (events ?? []).filter((e) => e.event_date && e.event_date < today).length;
  const upcoming = (events ?? []).filter((e) => e.event_date && e.event_date >= today).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{venue.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {[venue.address, venue.city, venue.state].filter(Boolean).join(", ") || "no address"}
            {venue.is_one_time && <span className="ml-2 rounded bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5 text-[10px] uppercase">one-time</span>}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="rounded-lg border border-zinc-300 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-1.5">
            <span className="font-bold text-zinc-900 dark:text-white">{timesWorked}</span>{" "}
            <span className="text-zinc-500">events worked</span>
          </span>
          <span className="rounded-lg border border-zinc-300 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-1.5">
            <span className="font-bold text-zinc-900 dark:text-white">{upcoming}</span>{" "}
            <span className="text-zinc-500">upcoming</span>
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* edit venue */}
        <div className="card p-5">
          <h2 className="card-title">Venue Details</h2>
          <form action={updateVenue.bind(null, id)} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label-xs">Name</label>
              <input name="name" defaultValue={venue.name} required className="input w-full" />
            </div>
            <div className="col-span-2">
              <label className="label-xs">Category</label>
              <select name="category_id" defaultValue={venue.category_id ?? ""} className="input w-full">
                <option value="">—</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-xs">Address</label>
              <input name="address" defaultValue={venue.address ?? ""} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">City</label>
              <input name="city" defaultValue={venue.city ?? ""} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">State</label>
              <input name="state" defaultValue={venue.state ?? ""} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Travel Fee ($)</label>
              <input type="number" step="0.01" name="travel_fee" defaultValue={venue.travel_fee} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Setup Fee ($)</label>
              <input type="number" step="0.01" name="setup_fee" defaultValue={venue.setup_fee} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Distance (mi)</label>
              <input type="number" step="0.1" name="distance_miles" defaultValue={venue.distance_miles ?? ""} className="input w-full" />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input type="checkbox" name="is_one_time" id="one_time" defaultChecked={venue.is_one_time} className="size-4 accent-brand-light" />
              <label htmlFor="one_time" className="text-sm text-zinc-600 dark:text-zinc-400">One-time venue</label>
            </div>
            <div className="col-span-2">
              <label className="label-xs">Load-In Details</label>
              <textarea name="load_in_details" rows={2} defaultValue={venue.load_in_details ?? ""} className="input w-full" />
            </div>
            <div className="col-span-2">
              <label className="label-xs">Driving Notes</label>
              <textarea name="driving_notes" rows={2} defaultValue={venue.driving_notes ?? ""} className="input w-full" />
            </div>
            <div className="col-span-2">
              <label className="label-xs">Notes</label>
              <textarea name="notes" rows={2} defaultValue={venue.notes ?? ""} className="input w-full" />
            </div>
            <div className="col-span-2">
              <button className="btn-primary">Save Venue</button>
            </div>
          </form>
        </div>

        <div className="space-y-5">
          {/* contacts */}
          <div className="card p-5">
            <h2 className="card-title">Contacts</h2>
            <ul className="mb-3 space-y-2 text-sm">
              {(contacts ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
                  <span>
                    <span className="font-semibold">{c.name}</span>
                    {c.role && <span className="ml-2 text-xs text-zinc-500">{c.role}</span>}
                    <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                  </span>
                  <form action={removeVenueContact.bind(null, id, c.id)}>
                    <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
              {(contacts ?? []).length === 0 && <li className="text-xs text-zinc-400 dark:text-zinc-600">No contacts yet.</li>}
            </ul>
            <form action={addVenueContact.bind(null, id)} className="grid grid-cols-2 gap-2">
              <input name="name" placeholder="Name" required className="input" />
              <input name="role" placeholder="Role (e.g. Event Manager)" className="input" />
              <input name="phone" placeholder="Phone" className="input" />
              <input name="email" placeholder="Email" className="input" />
              <div className="col-span-2">
                <button className="btn-ghost px-4 py-1.5 text-xs">Add Contact</button>
              </div>
            </form>
          </div>

          {/* rooms */}
          <div className="card p-5">
            <h2 className="card-title">Rooms</h2>
            <ul className="mb-3 flex flex-wrap gap-1.5">
              {(rooms ?? []).map((r) => (
                <li key={r.id} className="rounded-lg bg-black/[0.06] dark:bg-white/[0.07] px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {r.name}
                </li>
              ))}
              {(rooms ?? []).length === 0 && <li className="text-xs text-zinc-400 dark:text-zinc-600">No rooms defined.</li>}
            </ul>
            <form action={addVenueRoom.bind(null, id)} className="flex gap-2">
              <input name="name" placeholder="Room name" required className="input w-full" />
              <button className="btn-ghost px-4 py-1.5 text-xs">Add</button>
            </form>
          </div>
        </div>
      </div>

      {/* event history */}
      <h2 className="card-title mt-6">Events At This Venue</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((e: XEvent & { client: { first_name: string; last_name: string } | null }) => (
              <tr key={e.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 whitespace-nowrap">{e.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${e.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
                    {e.name || "(unnamed)"}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {e.client ? `${e.client.first_name} ${e.client.last_name}` : "—"}
                </td>
                <td className="px-4 py-2">
                  {e.status && (
                    <span className="chip" style={{ backgroundColor: e.status.color, color: e.status.text_color }}>
                      {e.status.name}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(events ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No events at this venue yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
        Travel fee {money(venue.travel_fee)} · Setup fee {money(venue.setup_fee)}
        {venue.distance_miles ? ` · ${venue.distance_miles} mi from warehouse` : ""}
      </p>
    </div>
  );
}
