import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Tabs from "@/components/Tabs";

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
};
type StatusFlags = { booked: boolean; leads: boolean; pending: boolean; lost: boolean };
type EventLite = { date: string | null; status_id: string | null };

const cols = "grid grid-cols-[1.6fr_1fr_1fr] gap-3";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let cq = supabase
    .from("clients")
    .select("id, first_name, last_name, cell_phone, email, organization")
    .order("first_name")
    .limit(1000);
  if (q) cq = cq.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);

  const [{ data: clientsData }, { data: statuses }, { data: evRows }, { data: coRows }] = await Promise.all([
    cq,
    supabase.from("event_statuses").select("id, is_booked_group, is_leads_group, is_pending_group, is_lost_sale_group"),
    supabase.from("events").select("client_id, event_date, status_id").is("archived_at", null),
    supabase.from("event_clients").select("client_id, event:events(event_date, status_id, archived_at)"),
  ]);

  const clients = (clientsData ?? []) as ClientRow[];

  const statusMap = new Map<string, StatusFlags>();
  for (const s of statuses ?? []) {
    statusMap.set(s.id, {
      booked: !!s.is_booked_group,
      leads: !!s.is_leads_group,
      pending: !!s.is_pending_group,
      lost: !!s.is_lost_sale_group,
    });
  }

  // client_id -> their events (primary + co-client links)
  const byClient = new Map<string, EventLite[]>();
  const push = (cid: string | null, ev: EventLite) => {
    if (!cid) return;
    const list = byClient.get(cid) ?? [];
    list.push(ev);
    byClient.set(cid, list);
  };
  for (const e of evRows ?? []) push(e.client_id, { date: e.event_date, status_id: e.status_id });
  for (const r of coRows ?? []) {
    const ev = (r as unknown as { client_id: string; event: { event_date: string | null; status_id: string | null; archived_at: string | null } | null }).event;
    if (ev && !ev.archived_at) push(r.client_id, { date: ev.event_date, status_id: ev.status_id });
  }

  const today = new Date().toISOString().slice(0, 10);
  const isActive = (cid: string): boolean =>
    (byClient.get(cid) ?? []).some((ev) => {
      const s = ev.status_id ? statusMap.get(ev.status_id) : null;
      if (!s) return false;
      if (s.leads || s.pending) return true; // open sales pipeline
      if (s.booked && ev.date && ev.date >= today) return true; // upcoming booking
      return false;
    });

  const latest = (cid: string): string | null => {
    const dates = (byClient.get(cid) ?? []).map((e) => e.date).filter((d): d is string => !!d);
    return dates.length ? dates.sort().at(-1)! : null;
  };

  const active = clients.filter((c) => isActive(c.id));
  const inactive = clients.filter((c) => !isActive(c.id) && (byClient.get(c.id)?.length ?? 0) > 0);

  const list = (rows: ClientRow[], emptyMsg: string) => (
    <div className="card overflow-hidden">
      <div className={`${cols} border-b border-zinc-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/[0.08]`}>
        <span>Name</span>
        <span>Phone</span>
        <span>Latest Event</span>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
        {rows.map((c) => {
          const l = latest(c.id);
          return (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className={`${cols} items-center px-4 py-3 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]`}>
                <span className="min-w-0 truncate font-medium">
                  {c.first_name} {c.last_name}
                  {c.organization && <span className="ml-1.5 text-xs text-zinc-400">· {c.organization}</span>}
                </span>
                <span className="truncate text-zinc-600 dark:text-zinc-400">{c.cell_phone || "—"}</span>
                <span className="text-zinc-600 dark:text-zinc-400">{l ? fmtDate(l) : "—"}</span>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-4 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">{emptyMsg}</li>}
      </ul>
    </div>
  );

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

      <Tabs
        tabs={[
          { id: "active", label: "Active", badge: active.length || undefined, content: list(active, "No active clients.") },
          { id: "inactive", label: "Inactive", badge: inactive.length || undefined, content: list(inactive, "No inactive clients.") },
          { id: "all", label: "All", badge: clients.length || undefined, content: list(clients, "No clients found.") },
        ]}
      />
    </div>
  );
}
