import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent, type ScheduledPayment, type Payment } from "@/lib/types";
import {
  addPayment,
  addScheduledPayments,
  addEventNote,
  addContractNote,
  addEventClient,
  createClientAndAttach,
  removeEventClient,
  setPrimaryEventClient,
  addClientNote,
  updateBookingInfo,
  updateBookingDates,
  addCustomDateField,
} from "../actions";
import ClientPicker from "@/components/ClientPicker";
import BookingInfoEditor from "@/components/BookingInfoEditor";
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
    { data: eventClients },
    { data: inquirySources },
    { data: dateDefs },
    { data: customDates },
    { data: eventLogs },
  ] = await Promise.all([
    supabase.from("scheduled_payments").select("*").eq("event_id", id).order("seq"),
    supabase.from("payments").select("*").eq("event_id", id).order("paid_at"),
    supabase.from("event_notes").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("booking_helpers").select("*").eq("is_active", true).order("position"),
    supabase.from("booking_helper_runs").select("helper_id").eq("event_id", id),
    supabase.from("event_staff").select("*, employee:employees(*)").eq("event_id", id),
    supabase.from("employees").select("*").eq("is_active", true).order("first_name"),
    supabase
      .from("event_clients")
      .select("*, client:clients(*)")
      .eq("event_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("custom_date_definitions").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("event_custom_dates").select("*").eq("event_id", id),
    supabase.from("event_logs").select("*").eq("event_id", id).order("created_at", { ascending: false }).limit(100),
  ]);

  const linkedClientIds = (eventClients ?? []).map((ec) => ec.client_id);
  const { data: clientNotes } = linkedClientIds.length
    ? await supabase
        .from("client_notes")
        .select("*")
        .in("client_id", linkedClientIds)
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; client_id: string; body: string; created_at: string }[] };

  const total = eventTotal(event);
  const paid = (payments ?? []).reduce((s: number, p: Payment) => s + Number(p.amount), 0);
  const balance = total - paid;
  const cf = (event.custom_fields ?? {}) as Record<string, string>;

  const addPaymentBound = addPayment.bind(null, id);
  const addScheduleBound = addScheduledPayments.bind(null, id);
  const addNoteBound = addEventNote.bind(null, id);

  const dt = (v: string | null | undefined) => v ?? "—";

  /* ---------- TAB: Client ---------- */
  const canRemove = (eventClients ?? []).length > 1;

  const clientTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {(eventClients ?? []).map((ec) => {
          const c = ec.client as {
            id: string;
            first_name: string;
            last_name: string;
            cell_phone: string | null;
            email: string | null;
            mailing_address: string | null;
          } | null;
          if (!c) return null;
          const notesForClient = (clientNotes ?? []).filter((n) => n.client_id === c.id);
          return (
            <div key={ec.id} className={`card p-5 ${ec.is_primary ? "ring-1 ring-brand-light/40" : ""}`}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-white">
                    <Link href={`/clients/${c.id}`} className="hover:text-brand-lighter hover:underline">
                      {c.first_name} {c.last_name}
                    </Link>
                  </h2>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-300">
                      {ec.role}
                    </span>
                    {ec.is_primary && (
                      <span className="rounded bg-gradient-to-r from-brand to-brand-light px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Primary
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  {!ec.is_primary && (
                    <form action={setPrimaryEventClient.bind(null, id, ec.id)}>
                      <button className="font-semibold text-brand-lighter hover:underline">Make Primary</button>
                    </form>
                  )}
                  {canRemove && !ec.is_primary && (
                    <form action={removeEventClient.bind(null, id, ec.id)}>
                      <button className="font-semibold text-red-400 hover:underline">Remove</button>
                    </form>
                  )}
                </div>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-zinc-500">Cell</dt><dd>{dt(c.cell_phone)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Email</dt><dd>{dt(c.email)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Address</dt><dd>{dt(c.mailing_address)}</dd></div>
              </dl>

              <h3 className="label-xs mt-4">Client Notes</h3>
              <form action={addClientNote.bind(null, id, c.id)} className="mb-2 flex gap-2">
                <input name="body" placeholder={`Note about ${c.first_name}…`} className="input w-full py-1.5 text-xs" />
                <button className="btn-ghost px-3 py-1 text-xs">Add</button>
              </form>
              <ul className="space-y-1.5">
                {notesForClient.map((n) => (
                  <li key={n.id} className="rounded-lg bg-white/[0.05] p-2 text-xs">
                    <span className="text-zinc-300">{n.body}</span>
                    <div className="mt-0.5 text-[10px] text-zinc-600">
                      {(n as { author_name?: string | null }).author_name ?? "unknown"} ·{" "}
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
                {notesForClient.length === 0 && (
                  <li className="text-xs text-zinc-600">No notes yet — e.g. &quot;Mentioned she hates country music.&quot;</li>
                )}
              </ul>
            </div>
          );
        })}
        {(eventClients ?? []).length === 0 && (
          <div className="card p-5">
            <p className="text-sm text-zinc-500">No clients on this event yet — add one below.</p>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card max-w-xl p-5">
          <h2 className="card-title">Add Client To Event</h2>
          <ClientPicker
            attachExisting={addEventClient.bind(null, id)}
            createAndAttach={createClientAndAttach.bind(null, id)}
          />
          <p className="mt-3 text-xs text-zinc-500">
            The Primary client is the contract holder — there must always be at least one client on the event.
          </p>
        </div>
      </div>
    </div>
  );

  /* ---------- TAB: Details ---------- */
  const venue = event.venue as
    | (typeof event.venue & { setup_fee?: number; driving_notes?: string | null; notes?: string | null })
    | null;
  const detailsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Event Details</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-zinc-500">Event Name</dt><dd className="font-semibold">{event.name || "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Event Type</dt><dd>{event.event_type?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Event Date</dt><dd className="font-semibold">{dt(event.event_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Setup Time</dt><dd>{dt(event.setup_time)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Start Time</dt><dd>{dt(event.start_time)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">End Time</dt><dd>{dt(event.end_time)}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Guest Count</dt><dd>{event.guest_count ?? "—"}</dd></div>
        </dl>
        <Link href={`/events/${id}/edit`} className="btn-ghost mt-4 px-4 py-1.5 text-xs">
          Edit Details
        </Link>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="card-title mb-0">Venue</h2>
          {venue && event.venue_id && (
            <Link href={`/venues/${event.venue_id}`} className="text-xs font-semibold text-brand-lighter hover:underline">
              Open Venue Page →
            </Link>
          )}
        </div>
        {venue ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Venue</dt><dd className="font-semibold">{venue.name}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Address</dt><dd className="text-right">{[venue.address, venue.city, venue.state].filter(Boolean).join(", ") || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Travel Fee</dt><dd>{money(venue.travel_fee)}</dd></div>
            {venue.setup_fee != null && venue.setup_fee > 0 && (
              <div className="flex justify-between"><dt className="text-zinc-500">Setup Fee</dt><dd>{money(venue.setup_fee)}</dd></div>
            )}
            {venue.load_in_details && (
              <div><dt className="text-zinc-500">Load-In</dt><dd className="mt-1 text-zinc-300">{venue.load_in_details}</dd></div>
            )}
            {venue.driving_notes && (
              <div><dt className="text-zinc-500">Driving Notes</dt><dd className="mt-1 text-zinc-300">{venue.driving_notes}</dd></div>
            )}
            {venue.notes && (
              <div><dt className="text-zinc-500">Venue Notes</dt><dd className="mt-1 text-zinc-300">{venue.notes}</dd></div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">No venue selected.</p>
        )}
      </div>

      <div className="card p-5">
        <h2 className="card-title">Vibo & Files</h2>
        <ul className="space-y-2.5 text-sm">
          {(
            [
              ["Vibo Event", cf.vibo_link, "Music planning for this event"],
              ["Google Drive Timeline", cf.gdrive_timeline, "Event timeline document"],
              ["Google Drive Folder", cf.gdrive_folder, "All event files"],
              ["Photo Booth Gallery", cf.photobooth_gallery, "Client gallery"],
            ] as const
          ).map(([label, url, hint]) =>
            url ? (
              <li key={label}>
                <a href={url} target="_blank" className="font-semibold text-brand-lighter hover:underline">
                  {label} ↗
                </a>
                <div className="text-xs text-zinc-600">{hint}</div>
              </li>
            ) : (
              <li key={label} className="text-zinc-600">
                {label} — <Link href={`/events/${id}/edit`} className="text-brand-lighter/70 hover:underline">add link</Link>
              </li>
            )
          )}
        </ul>
        <p className="mt-4 text-xs text-zinc-600">
          Coming soon: XOS will create the Drive folder and Vibo event automatically when an event books.
        </p>
      </div>
    </div>
  );

  /* ---------- TAB: Booking ---------- */
  const customValueByDef = new Map((customDates ?? []).map((cd) => [cd.definition_id, cd.value]));
  const contractNotes = (notes ?? []).filter((n) => n.kind === "contract");
  const internalNotes = (notes ?? []).filter((n) => n.kind !== "contract");
  const eventNumber = (event as unknown as { event_number?: number }).event_number;
  const bookedDate = (event as unknown as { booked_date?: string | null }).booked_date;

  const bookingTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="card-title mb-0">Booking Status</h2>
            {eventNumber && (
              <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-zinc-300">
                Event ID #{eventNumber}
              </span>
            )}
          </div>
          <BookingInfoEditor
            current={{
              statusId: event.status_id,
              sourceId: event.inquiry_source_id,
              sourceName: event.inquiry_source?.name ?? null,
              salespersonId: event.salesperson_id,
              salespersonName: event.salesperson
                ? `${event.salesperson.first_name} ${event.salesperson.last_name}`
                : null,
            }}
            statuses={statuses ?? []}
            sources={inquirySources ?? []}
            salespeople={(employees ?? []).map((e) => ({
              id: e.id,
              name: `${e.first_name} ${e.last_name}`.trim(),
            }))}
            save={updateBookingInfo.bind(null, id)}
          />
        </div>

        <div className="card p-5">
          <h2 className="card-title">Important Dates</h2>
          <form action={updateBookingDates.bind(null, id)} className="space-y-2.5">
            {(
              [
                ["initial_contact_date", "Initial Contact", event.initial_contact_date],
                ["contract_sent_date", "Contract Sent", event.contract_sent_date],
                ["contract_due_date", "Contract Due", event.contract_due_date],
                ["booked_date", "Date Booked", bookedDate ?? null],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name} className="flex items-center justify-between gap-3">
                <label className="text-sm text-zinc-500">{label}</label>
                <input type="date" name={name} defaultValue={value ?? ""} className="input w-44 py-1.5" />
              </div>
            ))}
            {(dateDefs ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3">
                <label className="text-sm text-zinc-500">{d.name}</label>
                <input
                  type="date"
                  name={`custom_${d.id}`}
                  defaultValue={customValueByDef.get(d.id) ?? ""}
                  className="input w-44 py-1.5"
                />
              </div>
            ))}
            <button className="btn-primary mt-1 px-5 py-2 text-xs">Save Dates</button>
          </form>
          <form action={addCustomDateField.bind(null, id)} className="mt-4 flex gap-2 border-t border-white/[0.06] pt-3">
            <input name="name" placeholder="New custom date field (global)…" className="input w-full py-1.5 text-xs" />
            <button className="btn-ghost px-3 py-1 text-xs">Add Field</button>
          </form>
        </div>
      </div>

      <div className="card max-w-3xl p-5">
        <h2 className="card-title">Contract Notes</h2>
        <form action={addContractNote.bind(null, id)} className="mb-3 flex gap-2">
          <input name="body" placeholder="Add a note about the contract…" className="input w-full" />
          <button className="btn-primary px-5">Add</button>
        </form>
        <ul className="space-y-2 text-sm">
          {contractNotes.map((n) => (
            <li key={n.id} className="rounded-lg bg-white/[0.05] p-3">
              <span className="text-zinc-300">{n.body}</span>
              <div className="mt-1 text-[11px] text-zinc-600">
                {n.author_name ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
              </div>
            </li>
          ))}
          {contractNotes.length === 0 && <li className="text-sm text-zinc-600">No contract notes yet.</li>}
        </ul>
      </div>

      <details className="card overflow-hidden">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-bold text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white">
          Event Log
          <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
            {(eventLogs ?? []).length}
          </span>
        </summary>
        <div className="max-h-96 overflow-y-auto border-t border-white/[0.06]">
          <table className="w-full text-sm">
            <tbody>
              {(eventLogs ?? []).map((l) => (
                <tr key={l.id} className="row">
                  <td className="px-5 py-2 whitespace-nowrap text-xs text-zinc-600">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs font-semibold text-brand-lighter">{l.actor}</td>
                  <td className="px-3 py-2 text-zinc-300">{l.action}</td>
                </tr>
              ))}
              {(eventLogs ?? []).length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-sm text-zinc-600">
                    No changes logged yet — the log starts recording once migration 00005 is applied.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
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
        {internalNotes.map((n: { id: string; body: string; created_at: string; author_name?: string | null }) => (
          <li key={n.id} className="rounded-lg bg-white/[0.05] p-3">
            <span className="text-zinc-300">{n.body}</span>
            <div className="mt-1 text-[11px] text-zinc-600">
              {n.author_name ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
            </div>
          </li>
        ))}
        {internalNotes.length === 0 && !event.internal_notes && (
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
            {eventNumber ? `#${eventNumber} · ` : ""}
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
          { id: "client", label: "Client", badge: (eventClients ?? []).length, content: clientTab },
          { id: "details", label: "Details", content: detailsTab },
          { id: "booking", label: "Booking", content: bookingTab },
          { id: "financials", label: "Financials", badge: balance > 0 ? money(balance) : undefined, content: financialsTab },
          { id: "staff", label: "Staff", badge: (staff ?? []).length, content: staffTab },
          { id: "notes", label: "Notes", badge: internalNotes.length, content: notesTab },
        ]}
      />
    </div>
  );
}
