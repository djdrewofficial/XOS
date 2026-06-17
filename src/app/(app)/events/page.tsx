import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EventsGrid, { type GridRow } from "@/components/EventsGrid";

export const dynamic = "force-dynamic";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const supabase = await createClient();
  const showArchived = (await searchParams).show === "archived";

  const eventsQuery = supabase
    .from("events")
    .select(
      "*, client:clients(first_name, last_name, cell_phone, email), status:event_statuses(name, color, text_color), package:packages(name, default_price, deposit_value), venue:venues(name, city, state, setup_fee), event_type:event_types(name), salesperson:employees(first_name, last_name), inquiry_source:inquiry_sources(name)"
    )
    .order("event_date", { ascending: true })
    .limit(1000);
  // active by default; ?show=archived flips to archived-only
  if (showArchived) eventsQuery.not("archived_at", "is", null);
  else eventsQuery.is("archived_at", null);

  const [{ data: events }, { data: staff }, { data: vendors }, { data: addons }, { data: payments }] =
    await Promise.all([
      eventsQuery,
      supabase.from("event_staff").select("event_id, employee:employees(first_name, last_name)"),
      supabase.from("event_vendors").select("event_id, vendor:vendors(company_name)"),
      supabase.from("event_addons").select("event_id, quantity, price_override, price_locked, addon:addons(name, default_price)"),
      supabase.from("payments").select("event_id, amount").eq("status", "approved"),
    ]);

  const staffByEvent = new Map<string, string[]>();
  (staff ?? []).forEach((s) => {
    const emp = s.employee as unknown as { first_name: string; last_name: string } | null;
    if (!emp) return;
    if (!staffByEvent.has(s.event_id)) staffByEvent.set(s.event_id, []);
    staffByEvent.get(s.event_id)!.push(`${emp.first_name} ${emp.last_name}`.trim());
  });

  const vendorsByEvent = new Map<string, string[]>();
  (vendors ?? []).forEach((v) => {
    const ven = v.vendor as unknown as { company_name: string } | null;
    if (!ven) return;
    if (!vendorsByEvent.has(v.event_id)) vendorsByEvent.set(v.event_id, []);
    vendorsByEvent.get(v.event_id)!.push(ven.company_name);
  });

  const addonsByEvent = new Map<string, { names: string[]; total: number }>();
  (addons ?? []).forEach((a) => {
    const ad = a.addon as unknown as { name: string; default_price: number } | null;
    const entry = addonsByEvent.get(a.event_id) ?? { names: [], total: 0 };
    if (ad) entry.names.push(a.quantity > 1 ? `${ad.name} ×${a.quantity}` : ad.name);
    entry.total +=
      (a.quantity ?? 1) *
      Number(a.price_override ?? (a as { price_locked?: number | null }).price_locked ?? ad?.default_price ?? 0);
    addonsByEvent.set(a.event_id, entry);
  });

  const paidByEvent = new Map<string, number>();
  (payments ?? []).forEach((p) => {
    if (p.event_id) paidByEvent.set(p.event_id, (paidByEvent.get(p.event_id) ?? 0) + Number(p.amount));
  });

  const rows: GridRow[] = (events ?? []).map((e) => {
    const client = e.client as unknown as { first_name: string; last_name: string; cell_phone: string | null; email: string | null } | null;
    const status = e.status as unknown as { name: string; color: string; text_color: string } | null;
    const pkg = e.package as unknown as { name: string; default_price: number } | null;
    const venue = e.venue as unknown as { name: string; city: string | null; state: string | null; setup_fee: number } | null;
    const sp = e.salesperson as unknown as { first_name: string; last_name: string } | null;
    const addonInfo = addonsByEvent.get(e.id) ?? { names: [], total: 0 };

    const total =
      Number(e.package_price_override ?? e.package_price_locked ?? pkg?.default_price ?? 0) +
      addonInfo.total +
      Number(e.overtime_fee) +
      Number(e.travel_fee) +
      Number(venue?.setup_fee ?? 0) -
      Number(e.discount1_amount) -
      Number(e.discount2_amount);
    const paid = paidByEvent.get(e.id) ?? 0;

    return {
      id: e.id,
      statusColor: status?.color ?? null,
      statusFg: status?.text_color ?? null,
      values: {
        event_number: e.event_number ?? null,
        event_date: e.event_date ?? null,
        event_name: e.name || "(unnamed)",
        event_type: (e.event_type as unknown as { name: string } | null)?.name ?? null,
        client: client ? `${client.first_name} ${client.last_name}`.trim() : null,
        client_cell: client?.cell_phone ?? null,
        client_email: client?.email ?? null,
        status: status?.name ?? null,
        package: pkg?.name ?? null,
        addons: addonInfo.names.join(", ") || null,
        balance_due: Math.round((total - paid) * 100) / 100,
        total_fee: Math.round(total * 100) / 100,
        payments_received: Math.round(paid * 100) / 100,
        venue: venue ? `${venue.name}${venue.city ? ` ${venue.city}, ${venue.state ?? ""}` : ""}`.trim() : null,
        salesperson: sp ? `${sp.first_name} ${sp.last_name}`.trim() : null,
        assigned_employees: (staffByEvent.get(e.id) ?? []).join(", ") || null,
        assigned_vendors: (vendorsByEvent.get(e.id) ?? []).join(", ") || null,
        inquiry_source: (e.inquiry_source as unknown as { name: string } | null)?.name ?? null,
        guest_count: e.guest_count ?? null,
        setup_time: e.setup_time ?? null,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
        booked_date: (e as unknown as { booked_date?: string | null }).booked_date ?? null,
        contract_sent: e.contract_sent_date ?? null,
        contract_due: e.contract_due_date ?? null,
        initial_contact: e.initial_contact_date ?? null,
        created: e.created_at?.slice(0, 10) ?? null,
      },
    };
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="page-title">{showArchived ? "Archived Events" : "Events List"}</h1>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? "/events" : "/events?show=archived"}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {showArchived ? "← Active events" : "Show archived"}
          </Link>
          <Link href="/events/new" className="btn-primary px-4 py-2 text-sm">
            Add Event
          </Link>
        </div>
      </div>
      <EventsGrid rows={rows} />
    </div>
  );
}
