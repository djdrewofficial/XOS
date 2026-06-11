import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClientForm from "@/components/ClientForm";
import { updateClientRecord } from "../actions";
import { money, eventTotal, type XEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: client }, { data: events }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("events")
      .select("*, status:event_statuses(*), package:packages(*), venue:venues(*)")
      .eq("client_id", id)
      .order("event_date", { ascending: false }),
  ]);

  if (!client) notFound();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-5 text-2xl font-bold">
        {client.first_name} {client.last_name}
        {client.organization && (
          <span className="ml-2 text-base font-normal text-zinc-500">{client.organization}</span>
        )}
      </h1>

      <h2 className="card-title">Events</h2>
      <div className="mb-6 card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((e: XEvent) => (
              <tr key={e.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2">{e.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${e.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {e.name || "(unnamed)"}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {e.status && (
                    <span
                      className="rounded px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: e.status.color, color: e.status.text_color }}
                    >
                      {e.status.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{e.venue?.name ?? "—"}</td>
                <td className="px-4 py-2 text-right">{money(eventTotal(e))}</td>
              </tr>
            ))}
            {(events ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-600 dark:text-zinc-400">
                  No events for this client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="card-title">Edit Client</h2>
      <ClientForm client={client} action={updateClientRecord.bind(null, id)} />
    </div>
  );
}
