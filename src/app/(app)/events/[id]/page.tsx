import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent, type ScheduledPayment, type Payment } from "@/lib/types";
import { addPayment, addScheduledPayments, addEventNote, setEventStatus } from "../actions";
import BookingHelperBar from "@/components/BookingHelperBar";
import StaffSection from "@/components/StaffSection";
import Tabs from "@/components/Tabs";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "*, client:clients(*), status:event_statuses(*), venue:venues(*), package:packages(*), event_type:event_types(*), salesperson:employees(*), inquiry_source:inquiry_sources(*)"
    )
    .eq("id", id)
    .single<XEvent & { inquiry_source: { name: string } | null }>();

  if (!event) notFound();

  const [
    { data: schedule },
    { data: payments },
    { data: notes },
    { data: statuses },
    { data: helpers },
    { data: helperRuns },
    { data: staff },
    { data: employees },
  ] = await Promise.all([
    supabase.from("scheduled_payments").select("*").eq("event_id", id).order("seq"),
    supabase.from("payments").select("*").eq("event_id", id).order("paid_at"),
    supabase.from("event_notes").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("booking_helpers").select("*").eq("is_active", true).order("position"),
    supabase.from("booking_helper_runs").select("helper_id").eq("event_id", id),
    supabase.from("event_staff").select("*, employee:employees(*)").eq("event_id", id),
    supabase.from("employees").select("*").eq("is_active", true).order("first_name"),
  ]);

  const total = eventTotal(event);
  const paid = (payments ?? []).reduce((s: number, p: Payment) => s + Number(p.amount), 0);
  const balance = total - paid;
  const cf = (event.custom_fields ?? {}) as Record<string, string>;

  const addPaymentBound = addPayment.bind(null, id);
  const addScheduleBound = addScheduledPayments.bind(null, id);
  const addNoteBound = addEventNote.bind(null, id);

  const dt = (v: string | null | undefined) => v ?? "—";

  /* ---------- TAB: Client ---------- */
  const clientTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Client</h2>
        {event.client ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Name</dt>
              <dd>
                <Link href={`/clients/${event.client.id}`} className="text-violet-300 hover:underline">
                  {event.client.first_name} {event.client.last_name}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between"><dt className="text-zinc-500">Cell</dt><dd>{dt(event.client.cell_phone)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Email</dt><dd>{dt(event.client.email)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Address</dt><dd>{dt(event.client.mailing_address)}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">No client linked — add one in Edit.</p>
        )}
      </div>
      <div className="card p-5">
        <h2 className="card-title">Links</h2>
        <ul className="space-y-2 text-sm">
          {(
            [
              ["Google Drive Timeline", cf.gdrive_timeline],
              ["Google Drive Folder", cf.gdrive_folder],
              ["Vibo", cf.vibo_link],
              ["Photo Booth Gallery", cf.photobooth_gallery],
            ] as const
          ).map(([label, url]) =>
            url ? (
              <li key={label}>
                <a href={url} target="_blank" className="text-violet-300 hover:underline">
                  {label} ↗
                </a>
              </li>
            ) : (
              <li key={label} className="text-zinc-600">
                {label} — not set
              </li>
            )
          )}
        </ul>
      </div>
    </div>
  );

  /* ---------- TAB: Details ---------- */
  const detailsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Event Details</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-zinc-500">Event Type</dt><dd>{event.event_type?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Event Date</dt><dd className="font-semibold">{dt(event.event_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Setup Time</dt><dd>{dt(event.setup_time)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Start / End</dt><dd>{dt(event.start_time)} – {dt(event.end_time)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Guest Count</dt><dd>{event.guest_count ?? "—"}</dd></div>
        </dl>
      </div>
      <div className="card p-5">
        <h2 className="card-title">Venue</h2>
        {event.venue ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Venue</dt><dd className="font-semibold">{event.venue.name}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Address</dt><dd>{[event.venue.address, event.venue.city, event.venue.state].filter(Boolean).join(", ") || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Travel Fee</dt><dd>{money(event.venue.travel_fee)}</dd></div>
            {event.venue.load_in_details && (
              <div><dt className="text-zinc-500">Load-In</dt><dd className="mt-1 text-zinc-300">{event.venue.load_in_details}</dd></div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">No venue selected.</p>
        )}
      </div>
    </div>
  );

  /* ---------- TAB: Booking ---------- */
  const bookingTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Status</h2>
        <div className="flex flex-wrap gap-1.5">
          {(statuses ?? []).map((s) => (
            <form key={s.id} action={setEventStatus.bind(null, id, s.id)}>
              <button
                type="submit"
                className={`status-chip transition-transform hover:scale-105 ${
                  s.id === event.status_id ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-black" : "opacity-80"
                }`}
                style={{ backgroundColor: s.color, color: s.text_color }}
              >
                {s.name}
              </button>
            </form>
          ))}
        </div>
      </div>
      <div className="card p-5">
        <h2 className="card-title">Sales Tracking</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-zinc-500">Inquiry Source</dt><dd>{event.inquiry_source?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Salesperson</dt><dd>{event.salesperson ? `${event.salesperson.first_name} ${event.salesperson.last_name}` : "—"}</dd></div>
        </dl>
        <h2 className="card-title mt-6">Important Dates</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-zinc-500">Initial Contact</dt><dd>{dt(event.initial_contact_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Contract Sent</dt><dd>{dt(event.contract_sent_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Contract Due</dt><dd>{dt(event.contract_due_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Contract Signed</dt><dd>{dt(event.contract_signed_date)}</dd></div>
        </dl>
      </div>
    </div>
  );

  /* ---------- TAB: Financials ---------- */
  const financialsTab = (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card p-5">
        <h2 className="card-title">Overview</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-zinc-500">Package</dt><dd>{event.package?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Total Fee</dt><dd className="font-semibold">{money(total)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Payments Received</dt><dd className="text-emerald-400">{money(paid)}</dd></div>
          <div className="row flex justify-between pt-2"><dt className="font-semibold">Outstanding Balance</dt><dd className="text-lg font-black text-white">{money(balance)}</dd></div>
        </dl>
        <h3 className="label-xs mt-6">Add Payment</h3>
        <form action={addPaymentBound} className="space-y-2">
          <input type="number" step="0.01" name="amount" placeholder="Amount" required className="input w-full" />
          <div className="flex gap-2">
            <select name="method" className="input w-full">
              {["card", "cash", "check", "zelle", "venmo", "ach", "other"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input type="date" name="paid_at" className="input w-full" />
          </div>
          <button className="btn-primary w-full">Add Payment</button>
        </form>
      </div>

      <div className="card p-5">
        <h2 className="card-title">Scheduled Payments</h2>
        <ul className="mb-4 space-y-1.5 text-sm">
          {(schedule ?? []).map((sp: ScheduledPayment) => (
            <li key={sp.id} className="flex justify-between">
              <span className="text-zinc-400">#{sp.seq} {sp.label} · due {sp.due_date ?? "—"}</span>
              <span className="font-semibold">{money(sp.amount)}</span>
            </li>
          ))}
          {(schedule ?? []).length === 0 && <li className="text-zinc-500">No payment schedule yet.</li>}
        </ul>
        <h3 className="label-xs">Generate Schedule (Auto-Split)</h3>
        <form action={addScheduleBound} className="space-y-2">
          <input type="hidden" name="total" value={total} />
          <input type="hidden" name="event_date" value={event.event_date ?? ""} />
          <div className="flex gap-2">
            <input type="number" step="0.01" name="deposit" defaultValue={event.deposit_value || event.package?.deposit_value || 0} className="input w-full" placeholder="Deposit" />
            <input type="number" name="count" defaultValue={2} min={1} max={12} className="input w-full" placeholder="# payments" />
          </div>
          <button className="btn-primary w-full">Auto-Split Balance</button>
          <p className="text-xs text-zinc-500">Deposit + N payments, evenly split, spaced 30 days before the event.</p>
        </form>
      </div>

      <div className="card p-5">
        <h2 className="card-title">Payment Log</h2>
        <ul className="divide-y divide-white/[0.06] text-sm">
          {(payments ?? []).map((p: Payment) => (
            <li key={p.id} className="flex justify-between py-2">
              <span className="text-zinc-400">
                {new Date(p.paid_at).toLocaleDateString()} · {p.method}
                {p.notes ? ` · ${p.notes}` : ""}
              </span>
              <span className="font-semibold text-emerald-400">{money(p.amount)}</span>
            </li>
          ))}
          {(payments ?? []).length === 0 && <li className="py-2 text-zinc-500">No payments yet.</li>}
        </ul>
      </div>
    </div>
  );

  /* ---------- TAB: Staff ---------- */
  const staffTab = <StaffSection eventId={id} staff={staff ?? []} employees={employees ?? []} />;

  /* ---------- TAB: Notes ---------- */
  const notesTab = (
    <div className="card max-w-3xl p-5">
      <h2 className="card-title">Internal Notes / Booking Comments</h2>
      <form action={addNoteBound} className="mb-4 flex gap-2">
        <input name="body" placeholder="Add a note…" className="input w-full" />
        <button className="btn-primary px-5">Add</button>
      </form>
      {event.internal_notes && (
        <p className="mb-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-100">{event.internal_notes}</p>
      )}
      <ul className="space-y-2 text-sm">
        {(notes ?? []).map((n: { id: string; body: string; created_at: string }) => (
          <li key={n.id} className="rounded-lg bg-white/[0.05] p-3">
            <span className="text-zinc-300">{n.body}</span>
            <span className="ml-2 text-xs text-zinc-600">{new Date(n.created_at).toLocaleString()}</span>
          </li>
        ))}
        {(notes ?? []).length === 0 && !event.internal_notes && (
          <li className="text-zinc-500">No notes yet.</li>
        )}
      </ul>
    </div>
  );

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{event.name || "(unnamed event)"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {event.event_date ?? "no date"} · {event.event_type?.name ?? "—"} ·{" "}
            {event.client ? `${event.client.first_name} ${event.client.last_name}` : "no client"} ·{" "}
            {event.venue?.name ?? "no venue"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {event.status && (
            <span
              className="status-chip px-3 py-1.5 text-sm"
              style={{ backgroundColor: event.status.color, color: event.status.text_color }}
            >
              {event.status.name}
            </span>
          )}
          <span className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-bold text-white md:inline">
            {money(balance)} <span className="text-xs font-medium text-zinc-500">due</span>
          </span>
          <Link href={`/events/${id}/edit`} className="btn-primary px-4 py-2">
            Edit
          </Link>
        </div>
      </div>

      <BookingHelperBar
        eventId={id}
        statusId={event.status_id}
        helpers={helpers ?? []}
        ranHelperIds={(helperRuns ?? []).map((r) => r.helper_id)}
        hasPayments={(payments ?? []).length > 0}
      />

      <Tabs
        tabs={[
          { id: "client", label: "Client", content: clientTab },
          { id: "details", label: "Details", content: detailsTab },
          { id: "booking", label: "Booking", content: bookingTab },
          { id: "financials", label: "Financials", badge: balance > 0 ? money(balance) : undefined, content: financialsTab },
          { id: "staff", label: "Staff", badge: (staff ?? []).length, content: staffTab },
          { id: "notes", label: "Notes", badge: (notes ?? []).length, content: notesTab },
        ]}
      />
    </div>
  );
}
