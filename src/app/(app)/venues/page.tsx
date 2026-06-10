import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { createVenue } from "./actions";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const supabase = await createClient();
  const { data: venues } = await supabase.from("venues").select("*").order("name");

  const input =
    "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none bg-white";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500";

  return (
    <div className="max-w-5xl">
      <h1 className="mb-5 text-2xl font-bold">Venues</h1>

      <div className="mb-6 overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2 text-right">Travel Fee</th>
              <th className="px-4 py-2 text-right">Setup Fee</th>
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(venues ?? []).map((v) => (
              <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <td className="px-4 py-2 font-medium">
                  {v.name}
                  {v.is_one_time && (
                    <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] uppercase">one-time</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {[v.address, v.city, v.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-2 text-right">{money(v.travel_fee)}</td>
                <td className="px-4 py-2 text-right">{money(v.setup_fee)}</td>
                <td className="max-w-xs truncate px-4 py-2 text-zinc-500">{v.notes ?? ""}</td>
              </tr>
            ))}
            {(venues ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">No venues yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-violet-700">Add Venue</h2>
      <form action={createVenue} className="grid gap-4 rounded-lg bg-white p-5 shadow md:grid-cols-3">
        <div>
          <label className={label}>Name</label>
          <input name="name" required className={input} />
        </div>
        <div>
          <label className={label}>Address</label>
          <input name="address" className={input} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label}>City</label>
            <input name="city" className={input} />
          </div>
          <div className="w-20">
            <label className={label}>State</label>
            <input name="state" defaultValue="FL" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Travel Fee ($)</label>
          <input type="number" step="0.01" name="travel_fee" defaultValue={0} className={input} />
        </div>
        <div>
          <label className={label}>Setup Fee ($)</label>
          <input type="number" step="0.01" name="setup_fee" defaultValue={0} className={input} />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input type="checkbox" name="is_one_time" id="one_time" />
          <label htmlFor="one_time" className="text-sm">One-time venue</label>
        </div>
        <div className="md:col-span-2">
          <label className={label}>Load-In Details</label>
          <input name="load_in_details" className={input} />
        </div>
        <div>
          <label className={label}>Notes</label>
          <input name="notes" className={input} />
        </div>
        <div className="md:col-span-3">
          <button className="rounded-md bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
            Add Venue
          </button>
        </div>
      </form>
    </div>
  );
}
