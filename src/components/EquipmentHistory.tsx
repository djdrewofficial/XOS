import Link from "next/link";

type Assignment = {
  id: string;
  quantity: number;
  packed: boolean;
  checked_out_at: string | null;
  checked_in_at: string | null;
  event: {
    id: string;
    name: string;
    event_date: string | null;
    venue: { name: string } | null;
    status: { name: string; color: string; text_color: string } | null;
  } | null;
};

export default function EquipmentHistory({ assignments }: { assignments: unknown[] }) {
  const rows = (assignments as Assignment[])
    .filter((a) => a.event)
    .sort((a, b) => (b.event!.event_date ?? "").localeCompare(a.event!.event_date ?? ""));

  return (
    <div className="mt-6">
      <h2 className="card-title">Event History</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Out / In</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2 whitespace-nowrap">{a.event!.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${a.event!.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
                    {a.event!.name || "(unnamed)"}
                  </Link>
                  {a.quantity > 1 && <span className="ml-1 text-xs text-zinc-500">×{a.quantity}</span>}
                </td>
                <td className="px-4 py-2">{a.event!.venue?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  {a.event!.status && (
                    <span className="chip" style={{ backgroundColor: a.event!.status.color, color: a.event!.status.text_color }}>
                      {a.event!.status.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  {a.checked_out_at ? `Out ${new Date(a.checked_out_at).toLocaleDateString()}` : "—"}
                  {" / "}
                  {a.checked_in_at ? `In ${new Date(a.checked_in_at).toLocaleDateString()}` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Never been assigned to an event yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
