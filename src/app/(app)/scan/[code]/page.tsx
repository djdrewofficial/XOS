import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { markEquipment, toggleEquipmentPacked } from "@/app/(app)/events/actions";

export const dynamic = "force-dynamic";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();

  const [{ data: item }, { data: system }] = await Promise.all([
    supabase.from("equipment_items").select("*").eq("qr_code", code).maybeSingle(),
    supabase.from("equipment_systems").select("*").eq("qr_code", code).maybeSingle(),
  ]);

  if (!item && !system) notFound();
  const gear = item ?? system!;
  const isSystem = !system ? false : true && !item;

  // active assignments: recent + upcoming events
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let q = supabase
    .from("event_equipment")
    .select("*, event:events(id, name, event_date, venue:venues(name))")
    .order("created_at");
  q = item ? q.eq("item_id", item.id) : q.eq("system_id", system!.id);
  const { data: assignments } = await q;

  type Row = {
    id: string;
    packed: boolean;
    checked_out_at: string | null;
    checked_in_at: string | null;
    event: { id: string; name: string; event_date: string | null; venue: { name: string } | null } | null;
  };
  const rows = ((assignments ?? []) as unknown as Row[])
    .filter((r) => r.event && (!r.event.event_date || r.event.event_date >= cutoffStr))
    .sort((a, b) => (a.event!.event_date ?? "").localeCompare(b.event!.event_date ?? ""));

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-6">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          {isSystem ? "Equipment System" : "Equipment Item"} · {code}
        </div>
        <h1 className="page-title">{gear.name}</h1>
        {"description" in gear && gear.description && (
          <p className="mt-1 text-sm text-zinc-500">{gear.description}</p>
        )}
        {"category" in gear && gear.category && (
          <p className="mt-1 text-sm text-zinc-500">{gear.category}</p>
        )}
        {gear.notes && (
          <p className="mt-2 rounded-lg bg-amber-400/10 p-2 text-sm text-amber-900 dark:text-amber-100">{gear.notes}</p>
        )}

        <h2 className="card-title mt-6">Current &amp; Upcoming Assignments</h2>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              <div className="mb-2 text-sm">
                <Link href={`/events/${r.event!.id}`} className="font-semibold text-brand dark:text-brand-lighter hover:underline">
                  {r.event!.name || "(unnamed)"}
                </Link>
                <span className="ml-2 text-zinc-500">
                  {r.event!.event_date ?? "no date"}
                  {r.event!.venue ? ` · ${r.event!.venue.name}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <form action={toggleEquipmentPacked.bind(null, r.event!.id, r.id, !r.packed)}>
                  <button
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      r.packed
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-black/[0.06] text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-400"
                    }`}
                  >
                    {r.packed ? "✓ Packed" : "Mark Packed"}
                  </button>
                </form>
                {r.checked_out_at ? (
                  <span className="rounded-lg bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-700 dark:text-amber-300">
                    Out {new Date(r.checked_out_at).toLocaleString()}
                  </span>
                ) : (
                  <form action={markEquipment.bind(null, r.event!.id, r.id, "checked_out_at")}>
                    <button className="btn-primary px-3 py-1.5 text-xs">Check Out</button>
                  </form>
                )}
                {r.checked_in_at ? (
                  <span className="rounded-lg bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    In {new Date(r.checked_in_at).toLocaleString()}
                  </span>
                ) : (
                  <form action={markEquipment.bind(null, r.event!.id, r.id, "checked_in_at")}>
                    <button className="btn-ghost px-3 py-1.5 text-xs">Check In</button>
                  </form>
                )}
              </div>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="text-sm text-zinc-500">
              Not assigned to any current or upcoming event.
            </li>
          )}
        </ul>

        <Link href="/equipment" className="btn-ghost mt-5 px-4 py-2 text-xs">
          ← All Equipment
        </Link>
      </div>
    </div>
  );
}
