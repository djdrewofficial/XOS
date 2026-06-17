import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type ClientRow = {
  id: string;
  first_name: string;
  last_name: string;
  cell_phone: string | null;
  email: string | null;
  organization: string | null;
  event_clients: { events: { event_date: string | null } | null }[] | null;
};

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select("id, first_name, last_name, cell_phone, email, organization, event_clients(events(event_date))")
    .order("first_name")
    .limit(500);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
  const { data } = await query;
  const clients = (data ?? []) as unknown as ClientRow[];

  const latestEvent = (c: ClientRow): string | null => {
    const dates = (c.event_clients ?? []).map((ec) => ec.events?.event_date).filter((d): d is string => !!d);
    return dates.length ? dates.sort().at(-1)! : null; // ISO dates sort lexically
  };

  const cols = "grid grid-cols-[1.6fr_1fr_1fr] gap-3";

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Link href="/clients/new" className="btn-primary px-4 py-2">
          Add Client
        </Link>
      </div>

      <form className="mb-4">
        <input name="q" defaultValue={q ?? ""} placeholder="Search clients…" className="input w-full px-4 py-2.5" />
      </form>

      <div className="card overflow-hidden">
        <div className={`${cols} border-b border-zinc-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/[0.08]`}>
          <span>Name</span>
          <span>Phone</span>
          <span>Latest Event</span>
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {clients.map((c) => {
            const latest = latestEvent(c);
            return (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className={`${cols} items-center px-4 py-3 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]`}>
                  <span className="min-w-0 truncate font-medium">
                    {c.first_name} {c.last_name}
                    {c.organization && <span className="ml-1.5 text-xs text-zinc-400">· {c.organization}</span>}
                  </span>
                  <span className="truncate text-zinc-600 dark:text-zinc-400">{c.cell_phone || "—"}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{latest ? fmtDate(latest) : "—"}</span>
                </Link>
              </li>
            );
          })}
          {clients.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">No clients found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
