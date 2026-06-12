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
  addEventAddon,
  removeEventAddon,
  addExpense,
  deleteExpense,
  addTrip,
  deleteTrip,
  updateEventDetails,
  updateEventVenue,
  updateEventLinks,
  updateEventFinancials,
  addEventVendor,
  removeEventVendor,
  addEventEquipment,
  removeEventEquipment,
  toggleEquipmentPacked,
  markEquipment,
  updateEquipmentNotes,
  addLogisticsNote,
  deleteEvent,
} from "../actions";
import InlineEditCard from "@/components/InlineEditCard";
import ClientPicker from "@/components/ClientPicker";
import BookingInfoEditor from "@/components/BookingInfoEditor";
import AddonPicker from "@/components/AddonPicker";
import BookingHelperBar from "@/components/BookingHelperBar";
import StaffSection from "@/components/StaffSection";
import Tabs from "@/components/Tabs";
import SaveButton from "@/components/SaveButton";

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
    { data: paySettings },
    { data: expSettings },
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
    supabase.from("payment_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("expense_settings").select("payees").eq("id", true).maybeSingle(),
  ]);

  const [
    { data: eventAddons },
    { data: addonCatalog },
    { data: expenses },
    { data: expenseCategories },
    { data: trips },
    { data: vehicles },
  ] = await Promise.all([
    supabase.from("event_addons").select("*, addon:addons(*)").eq("event_id", id),
    supabase.from("addons").select("*").eq("is_active", true).order("display_order"),
    supabase
      .from("expenses")
      .select("*, category:expense_categories(name)")
      .eq("event_id", id)
      .order("expense_date", { ascending: false }),
    supabase.from("expense_categories").select("*").eq("is_active", true).order("name"),
    supabase
      .from("event_trips")
      .select("*, vehicle:vehicles(name)")
      .eq("event_id", id)
      .order("trip_date", { ascending: false }),
    supabase.from("vehicles").select("*").eq("is_active", true).order("name"),
  ]);

  const [{ data: eventTypes }, { data: venuesList }, { data: packagesList }, { data: eventVendors }, { data: vendorsList }] =
    await Promise.all([
      supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
      supabase.from("venues").select("id, name").order("name"),
      supabase.from("packages").select("id, name").eq("is_active", true).order("display_order"),
      supabase
        .from("event_vendors")
        .select("*, vendor:vendors(id, company_name, category)")
        .eq("event_id", id)
        .order("created_at"),
      supabase.from("vendors").select("id, company_name, category").order("company_name"),
    ]);

  const [{ data: eventEquipment }, { data: equipmentItems }, { data: equipmentSystems }] =
    await Promise.all([
      supabase
        .from("event_equipment")
        .select("*, item:equipment_items(id, name, category, qr_code), system:equipment_systems(id, name, description, qr_code)")
        .eq("event_id", id)
        .order("created_at"),
      supabase.from("equipment_items").select("id, name, category").eq("is_active", true).order("name"),
      supabase.from("equipment_systems").select("id, name").eq("is_active", true).order("name"),
    ]);

  const linkedClientIds = (eventClients ?? []).map((ec) => ec.client_id);
  const { data: clientNotes } = linkedClientIds.length
    ? await supabase
        .from("client_notes")
        .select("*")
        .in("client_id", linkedClientIds)
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; client_id: string; body: string; created_at: string }[] };

  type EventAddonRow = {
    id: string;
    quantity: number;
    price_override: number | null;
    price_locked?: number | null;
    addon: { id: string; name: string; default_price: number; description: string | null } | null;
  };
  const addonRows = (eventAddons ?? []) as unknown as EventAddonRow[];
  const addonLine = (ea: EventAddonRow) =>
    ea.quantity * Number(ea.price_override ?? ea.price_locked ?? ea.addon?.default_price ?? 0);
  const addonsTotal = addonRows.reduce((s, ea) => s + addonLine(ea), 0);
  const venueSetupFee = Number(
    (event.venue as unknown as { setup_fee?: number } | null)?.setup_fee ?? 0
  );

  const total = eventTotal(event) + addonsTotal + venueSetupFee;
  const paid = (payments ?? []).reduce((s: number, p: Payment) => s + Number(p.amount), 0);
  const balance = total - paid;
  const cf = (event.custom_fields ?? {}) as Record<string, string>;

  // payment-settings-driven add-payment defaults (configured in Settings → Payment Settings)
  const ps = paySettings as {
    payment_methods: string[];
    expense_payment_methods: string[];
    payment_reasons: string[];
    prefill_reasons: string[];
    autofill_no_payments: string;
    autofill_after_payments: string;
  } | null;
  const payeeOptions = (expSettings as { payees?: string[] } | null)?.payees ?? [];
  const expenseMethodOptions = ps?.expense_payment_methods ?? [];
  const methodOptions =
    ps?.payment_methods?.length ? ps.payment_methods : ["Cash", "Credit Card", "Zelle", "Other"];
  const autofillMode = (payments ?? []).length === 0 ? ps?.autofill_no_payments : ps?.autofill_after_payments;
  const scheduleRows = (schedule ?? []) as ScheduledPayment[];
  const paidSoFarCount = (payments ?? []).length;
  let autofillAmount: number | undefined;
  if (autofillMode === "retainer_fee") {
    autofillAmount = Number(scheduleRows[0]?.amount) || undefined;
  } else if (autofillMode === "next_scheduled") {
    autofillAmount = Number(scheduleRows[paidSoFarCount]?.amount) || (balance > 0 ? balance : undefined);
  } else if (autofillMode === "balance_due") {
    autofillAmount = balance > 0 ? balance : undefined;
  }
  const prefillReason = ps?.prefill_reasons?.[Math.min(paidSoFarCount, 2)] || "";
  const reasonOptions = Array.from(
    new Set([...(prefillReason ? [prefillReason] : []), ...(ps?.payment_reasons ?? [])])
  );

  const addPaymentBound = addPayment.bind(null, id);
  const addScheduleBound = addScheduledPayments.bind(null, id);
  const addNoteBound = addEventNote.bind(null, id);

  const dt = (v: string | null | undefined) => v ?? "—";
  const fmtTime = (t: string | null) => {
    if (!t) return "—";
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
  };

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
                  <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                    <Link href={`/clients/${c.id}`} className="hover:text-brand dark:text-brand-lighter hover:underline">
                      {c.first_name} {c.last_name}
                    </Link>
                  </h2>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="rounded bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
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
                      <button className="font-semibold text-brand dark:text-brand-lighter hover:underline">Make Primary</button>
                    </form>
                  )}
                  {canRemove && !ec.is_primary && (
                    <form action={removeEventClient.bind(null, id, ec.id)}>
                      <button className="font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>
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
                <SaveButton className="btn-ghost px-3 py-1 text-xs" savedLabel="Added">Add</SaveButton>
              </form>
              <ul className="space-y-1.5">
                {notesForClient.map((n) => (
                  <li key={n.id} className="rounded-lg bg-black/[0.04] dark:bg-white/[0.05] p-2 text-xs">
                    <span className="text-zinc-700 dark:text-zinc-300">{n.body}</span>
                    <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-600">
                      {(n as { author_name?: string | null }).author_name ?? "unknown"} ·{" "}
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
                {notesForClient.length === 0 && (
                  <li className="text-xs text-zinc-400 dark:text-zinc-600">No notes yet — e.g. &quot;Mentioned she hates country music.&quot;</li>
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
        <InlineEditCard
          save={updateEventDetails.bind(null, id)}
          fields={[
            { name: "name", label: "Event Name", type: "text", value: event.name, span2: true },
            {
              name: "event_type_id",
              label: "Event Type",
              type: "select",
              value: event.event_type_id,
              options: (eventTypes ?? []).map((t) => ({ value: t.id, label: t.name })),
            },
            { name: "event_date", label: "Event Date", type: "date", value: event.event_date },
            { name: "setup_time", label: "Setup Time", type: "time", value: event.setup_time },
            { name: "guest_count", label: "Guest Count", type: "number", value: event.guest_count },
            { name: "start_time", label: "Start Time", type: "time", value: event.start_time },
            { name: "end_time", label: "End Time", type: "time", value: event.end_time },
          ]}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Event Name</dt><dd className="font-semibold">{event.name || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Event Type</dt><dd>{event.event_type?.name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Event Date</dt><dd className="font-semibold">{dt(event.event_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Setup Time</dt><dd>{fmtTime(event.setup_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Start Time</dt><dd>{fmtTime(event.start_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">End Time</dt><dd>{fmtTime(event.end_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Guest Count</dt><dd>{event.guest_count ?? "—"}</dd></div>
          </dl>
        </InlineEditCard>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="card-title mb-0">Venue</h2>
          {venue && event.venue_id && (
            <Link href={`/venues/${event.venue_id}`} className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
              Open Venue Page →
            </Link>
          )}
        </div>
        <InlineEditCard
          save={updateEventVenue.bind(null, id)}
          editLabel={venue ? "Change Venue" : "Select Venue"}
          fields={[
            {
              name: "venue_id",
              label: "Venue",
              type: "select",
              value: event.venue_id,
              span2: true,
              options: (venuesList ?? []).map((v) => ({ value: v.id, label: v.name })),
            },
          ]}
        >
          {venue ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Venue</dt><dd className="font-semibold">{venue.name}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Address</dt><dd className="text-right">{[venue.address, venue.city, venue.state].filter(Boolean).join(", ") || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Travel Fee</dt><dd>{money(venue.travel_fee)}</dd></div>
              {venue.setup_fee != null && venue.setup_fee > 0 && (
                <div className="flex justify-between"><dt className="text-zinc-500">Setup Fee</dt><dd>{money(venue.setup_fee)}</dd></div>
              )}
              {venue.load_in_details && (
                <div><dt className="text-zinc-500">Load-In</dt><dd className="mt-1 text-zinc-700 dark:text-zinc-300">{venue.load_in_details}</dd></div>
              )}
              {venue.driving_notes && (
                <div><dt className="text-zinc-500">Driving Notes</dt><dd className="mt-1 text-zinc-700 dark:text-zinc-300">{venue.driving_notes}</dd></div>
              )}
              {venue.notes && (
                <div><dt className="text-zinc-500">Venue Notes</dt><dd className="mt-1 text-zinc-700 dark:text-zinc-300">{venue.notes}</dd></div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">No venue selected.</p>
          )}
        </InlineEditCard>
      </div>

      <div className="card p-5">
        <h2 className="card-title">Vibo & Files</h2>
        <InlineEditCard
          save={updateEventLinks.bind(null, id)}
          editLabel="Edit Links"
          fields={[
            { name: "vibo_link", label: "Vibo Event Link", type: "url", value: cf.vibo_link ?? "", span2: true, placeholder: "https://…" },
            { name: "gdrive_timeline", label: "Google Drive Timeline", type: "url", value: cf.gdrive_timeline ?? "", span2: true, placeholder: "https://…" },
            { name: "gdrive_folder", label: "Google Drive Folder", type: "url", value: cf.gdrive_folder ?? "", span2: true, placeholder: "https://…" },
            { name: "photobooth_gallery", label: "Photo Booth Gallery", type: "url", value: cf.photobooth_gallery ?? "", span2: true, placeholder: "https://…" },
          ]}
        >
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
                  <a href={url} target="_blank" className="font-semibold text-brand dark:text-brand-lighter hover:underline">
                    {label} ↗
                  </a>
                  <div className="text-xs text-zinc-400 dark:text-zinc-600">{hint}</div>
                </li>
              ) : (
                <li key={label} className="text-zinc-400 dark:text-zinc-600">
                  {label} — not set
                </li>
              )
            )}
          </ul>
          <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-600">
            Coming soon: XOS will create the Drive folder and Vibo event automatically when an event books.
          </p>
        </InlineEditCard>
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
              <span className="rounded-lg bg-black/[0.05] dark:bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-zinc-700 dark:text-zinc-300">
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
            <SaveButton className="btn-primary mt-1 px-5 py-2 text-xs">Save Dates</SaveButton>
          </form>
          <form action={addCustomDateField.bind(null, id)} className="mt-4 flex gap-2 border-t border-zinc-200 dark:border-white/[0.06] pt-3">
            <input name="name" placeholder="New custom date field (global)…" className="input w-full py-1.5 text-xs" />
            <SaveButton className="btn-ghost px-3 py-1 text-xs" savedLabel="Added">Add Field</SaveButton>
          </form>
        </div>
      </div>

      <div className="card max-w-3xl p-5">
        <h2 className="card-title">Contract Notes</h2>
        <form action={addContractNote.bind(null, id)} className="mb-3 flex gap-2">
          <input name="body" placeholder="Add a note about the contract…" className="input w-full" />
          <SaveButton className="btn-primary px-5" savedLabel="Added">Add</SaveButton>
        </form>
        <ul className="space-y-2 text-sm">
          {contractNotes.map((n) => (
            <li key={n.id} className="rounded-lg bg-black/[0.04] dark:bg-white/[0.05] p-3">
              <span className="text-zinc-700 dark:text-zinc-300">{n.body}</span>
              <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
                {n.author_name ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
              </div>
            </li>
          ))}
          {contractNotes.length === 0 && <li className="text-sm text-zinc-400 dark:text-zinc-600">No contract notes yet.</li>}
        </ul>
      </div>

      <details className="card overflow-hidden">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-bold text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-white">
          Event Log
          <span className="ml-2 rounded-full bg-black/[0.07] dark:bg-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:text-zinc-400">
            {(eventLogs ?? []).length}
          </span>
        </summary>
        <div className="max-h-96 overflow-y-auto border-t border-zinc-200 dark:border-white/[0.06]">
          <table className="w-full text-sm">
            <tbody>
              {(eventLogs ?? []).map((l) => (
                <tr key={l.id} className="row">
                  <td className="px-5 py-2 whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-600">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs font-semibold text-brand dark:text-brand-lighter">{l.actor}</td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{l.action}</td>
                </tr>
              ))}
              {(eventLogs ?? []).length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-600">
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
  const wages = (staff ?? []).reduce((s: number, st: { flat_wage: number }) => s + Number(st.flat_wage), 0);
  const expensesTotal = (expenses ?? []).reduce((s, x) => s + Number(x.amount), 0);
  const netProfit = total - wages - expensesTotal;
  const totalMiles = (trips ?? []).reduce((s, t) => s + Number(t.miles), 0);
  const pkgPrice = event.package_price_override ?? event.package_price_locked ?? event.package?.default_price ?? 0;
  // description pinned to the version the event was sold with (falls back to live package)
  let pkgDescription = (event.package as unknown as { description?: string | null } | null)?.description;
  const pinnedVersionNo = (event as { package_version_no?: number | null }).package_version_no;
  if (event.package_id && pinnedVersionNo != null) {
    const { data: pinnedVersion } = await supabase
      .from("package_versions")
      .select("snapshot")
      .eq("package_id", event.package_id)
      .eq("version_no", pinnedVersionNo)
      .maybeSingle();
    const snapDesc = (pinnedVersion?.snapshot as { description?: string | null } | undefined)?.description;
    if (snapDesc !== undefined) pkgDescription = snapDesc;
  }
  const pkgRules = event.package as unknown as {
    allowed_splits?: number[] | null;
    payment_terms?: string | null;
    payment_terms_days?: number | null;
  } | null;
  const paymentRules = {
    splits: pkgRules?.allowed_splits?.length ? pkgRules.allowed_splits : [1, 2, 3],
    terms: pkgRules?.payment_terms ?? "days_before",
    days: pkgRules?.payment_terms_days ?? 30,
  };

  const feeRow = "flex justify-between py-1.5 text-sm";

  const financialsTab = (
    <div className="space-y-5">
      {/* row 1: package & add-ons | fee summary */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Package &amp; Add-Ons</h2>

          {event.package ? (
            <details className="mb-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm">
                <span className="font-semibold text-zinc-900 dark:text-white">{event.package.name}</span>
                <span className="font-semibold">{money(pkgPrice)}</span>
              </summary>
              <div className="border-t border-zinc-200 dark:border-white/[0.06] px-3 py-2.5 text-xs whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                {pkgDescription || "No description on file — add one in Supabase (packages.description)."}
              </div>
            </details>
          ) : (
            <p className="mb-3 text-sm text-zinc-500">No package selected.</p>
          )}

          {addonRows.map((ea) => (
            <details key={ea.id} className="mb-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm">
                <span className="text-zinc-800 dark:text-zinc-200">
                  {ea.addon?.name ?? "?"}{" "}
                  <span className="text-xs text-zinc-500">
                    ({ea.quantity} @ {money(ea.price_override ?? ea.price_locked ?? ea.addon?.default_price ?? 0)})
                  </span>
                </span>
                <span className="font-semibold">{money(addonLine(ea))}</span>
              </summary>
              <div className="border-t border-zinc-200 dark:border-white/[0.06] px-3 py-2.5 text-xs">
                <p className="mb-2 whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                  {ea.addon?.description || "No description on file."}
                </p>
                <form action={removeEventAddon.bind(null, id, ea.id)}>
                  <button className="font-semibold text-red-600 dark:text-red-400 hover:underline">Remove Add-On</button>
                </form>
              </div>
            </details>
          ))}

          <div className="row mt-3 flex justify-between pt-3 text-sm">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Package &amp; Add-Ons Sub Total</span>
            <span className="font-bold text-zinc-900 dark:text-white">{money(pkgPrice + addonsTotal)}</span>
          </div>

          <h3 className="label-xs mt-5">Add An Add-On</h3>
          <AddonPicker catalog={addonCatalog ?? []} action={addEventAddon.bind(null, id)} />
        </div>

        <div className="card p-5">
          <h2 className="card-title">Fee Summary Report</h2>
          <InlineEditCard
            save={updateEventFinancials.bind(null, id)}
            editLabel="Edit Fees"
            fields={[
              {
                name: "package_id",
                label: "Package",
                type: "select",
                value: event.package_id,
                span2: true,
                options: (packagesList ?? []).map((p) => ({ value: p.id, label: p.name })),
              },
              { name: "package_price_override", label: "Package Price Override ($)", type: "number", step: "0.01", value: event.package_price_override, placeholder: "blank = default" },
              { name: "deposit_value", label: "Deposit ($)", type: "number", step: "0.01", value: event.deposit_value },
              { name: "overtime_fee", label: "Overtime Fee ($)", type: "number", step: "0.01", value: event.overtime_fee },
              { name: "travel_fee", label: "Travel Fee ($)", type: "number", step: "0.01", value: event.travel_fee },
              { name: "discount1_amount", label: "Discount 1 ($)", type: "number", step: "0.01", value: event.discount1_amount },
              { name: "discount2_amount", label: "Discount 2 ($)", type: "number", step: "0.01", value: event.discount2_amount },
            ]}
          >
          <div className="divide-y divide-white/[0.05]">
            {event.package && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">{event.package.name}</span>
                <span>{money(pkgPrice)}</span>
              </div>
            )}
            {addonRows.map((ea) => (
              <div key={ea.id} className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {ea.addon?.name} ({ea.quantity} @ {money(ea.price_override ?? ea.price_locked ?? ea.addon?.default_price ?? 0)})
                </span>
                <span>{money(addonLine(ea))}</span>
              </div>
            ))}
            {event.overtime_fee > 0 && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">Overtime</span>
                <span>{money(event.overtime_fee)}</span>
              </div>
            )}
            {event.travel_fee > 0 && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">Travel Fee</span>
                <span>{money(event.travel_fee)}</span>
              </div>
            )}
            {venueSetupFee > 0 && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">Venue Setup Fee ({event.venue?.name})</span>
                <span>{money(venueSetupFee)}</span>
              </div>
            )}
            {event.discount1_amount > 0 && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">Discount{event.discount1_label ? ` — ${event.discount1_label}` : " 1"}</span>
                <span className="text-emerald-600 dark:text-emerald-400">−{money(event.discount1_amount)}</span>
              </div>
            )}
            {event.discount2_amount > 0 && (
              <div className={feeRow}>
                <span className="text-zinc-600 dark:text-zinc-400">Discount{event.discount2_label ? ` — ${event.discount2_label}` : " 2"}</span>
                <span className="text-emerald-600 dark:text-emerald-400">−{money(event.discount2_amount)}</span>
              </div>
            )}
          </div>

          <div className="mt-2 flex justify-between rounded-lg bg-black/[0.05] dark:bg-white/[0.06] px-3 py-2.5 text-sm">
            <span className="font-bold text-zinc-900 dark:text-white">TOTAL FEE</span>
            <span className="font-black text-zinc-900 dark:text-white">{money(total)}</span>
          </div>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Deposit</dt>
              <dd>{money(event.deposit_value || event.package?.deposit_value || 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Payments Received</dt>
              <dd className="text-emerald-600 dark:text-emerald-400">{money(paid)}</dd>
            </div>
          </dl>
          <div className="mt-2 flex justify-between rounded-lg bg-amber-400/10 px-3 py-2.5 text-sm">
            <span className="font-bold text-amber-800 dark:text-amber-200">BALANCE DUE</span>
            <span className="font-black text-amber-900 dark:text-amber-100">{money(balance)}</span>
          </div>
          </InlineEditCard>
        </div>
      </div>

      {/* row 2: payments | profitability */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Payment Schedule</h2>
          <ul className="mb-3 space-y-1.5 text-sm">
            {(schedule ?? []).map((sp: ScheduledPayment) => (
              <li key={sp.id} className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">#{sp.seq} {sp.label} · due {sp.due_date ?? "—"}</span>
                <span className="font-semibold">{money(sp.amount)}</span>
              </li>
            ))}
            {(schedule ?? []).length === 0 && <li className="text-zinc-400 dark:text-zinc-600">No payment schedule yet — generate one below.</li>}
          </ul>
          <h3 className="label-xs">Generate Schedule</h3>
          <form action={addScheduleBound} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="total" value={total} />
            <input type="hidden" name="event_date" value={event.event_date ?? ""} />
            <div>
              <label className="label-xs">Deposit</label>
              <input type="number" step="0.01" name="deposit" defaultValue={event.deposit_value || event.package?.deposit_value || 0} className="input w-28" />
            </div>
            <div>
              <label className="label-xs">Split</label>
              <select name="count" className="input w-44">
                {paymentRules.splits.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Pay in full (1 payment)" : `${n} monthly payments`}
                  </option>
                ))}
              </select>
            </div>
            <SaveButton className="btn-primary px-4 py-2 text-xs" savedLabel="Done">Generate</SaveButton>
          </form>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
            Package rules: splits of {paymentRules.splits.join(" / ")} ·{" "}
            {paymentRules.terms === "net_days_after"
              ? `Net ${paymentRules.days} — balance due ${paymentRules.days} days after the event`
              : `balance due ${paymentRules.days} days before the event date`}
            . These same limits will gate the client&apos;s schedule choice in the booking-agreement workflow.
          </p>

          <h3 className="label-xs mt-5">Payments Received</h3>
          <form action={addPaymentBound} className="mb-3 flex flex-wrap items-end gap-2">
            <input
              type="number"
              step="0.01"
              name="amount"
              placeholder="Amount"
              required
              defaultValue={autofillAmount !== undefined ? autofillAmount.toFixed(2) : undefined}
              className="input w-28"
            />
            <select name="method" className="input w-36">
              {methodOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select name="reason" defaultValue={prefillReason} className="input w-40">
              <option value="">— Reason —</option>
              {reasonOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input type="date" name="paid_at" className="input w-40" />
            <SaveButton className="btn-ghost px-4 py-2 text-xs" savedLabel="Added">Add Payment</SaveButton>
          </form>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06] text-sm">
            {(payments ?? []).map((p: Payment) => (
              <li key={p.id} className="flex justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {new Date(p.paid_at).toLocaleDateString()} · {p.method}
                  {(p as Payment & { reason?: string | null }).reason
                    ? ` · ${(p as Payment & { reason?: string | null }).reason}`
                    : ""}
                  {p.notes ? ` · ${p.notes}` : ""}
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{money(p.amount)}</span>
              </li>
            ))}
            {(payments ?? []).length === 0 && <li className="py-2 text-zinc-500">No payments yet.</li>}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="card-title">Event Profitability</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Total Fee</dt><dd>{money(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Employee Wages</dt><dd className="text-red-700 dark:text-red-300">−{money(wages)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Related Expenses</dt><dd className="text-red-700 dark:text-red-300">−{money(expensesTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Tax</dt><dd>{money(0)}</dd></div>
            <div className="row flex justify-between pt-2">
              <dt className="font-bold text-zinc-900 dark:text-white">Net Profit</dt>
              <dd className={`text-lg font-black ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{money(netProfit)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Profit Ratio (Net Profit / Total Fee)</dt>
              <dd>{total > 0 ? `${((netProfit / total) * 100).toFixed(1)}%` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Cost Per Guest (Total Fee / Guest Count)</dt>
              <dd>{event.guest_count ? money(total / event.guest_count) : "—"}</dd>
            </div>
            {totalMiles > 0 && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">Miles Driven</dt>
                <dd>{totalMiles.toFixed(1)} mi</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* row 3: expenses | trip tracker */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Event Expenses</h2>
          <form action={addExpense.bind(null, id)} className="mb-4 grid grid-cols-2 gap-2">
            <input type="number" step="0.01" name="amount" placeholder="Amount" required className="input" />
            <input type="date" name="expense_date" className="input" />
            <select name="category_id" className="input">
              <option value="">Category…</option>
              {(expenseCategories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input name="new_category" placeholder="…or new category" className="input" />
            <input name="payee" placeholder="Payee (e.g. subcontractor)" list="payee-options" className="input" />
            <datalist id="payee-options">
              {payeeOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <select name="payment_method" className="input">
              <option value="">Payment method…</option>
              {expenseMethodOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input name="description" placeholder="Description" className="input col-span-2" />
            <div className="col-span-2">
              <SaveButton className="btn-primary px-5 py-2 text-xs" savedLabel="Added">Add Expense</SaveButton>
            </div>
          </form>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06] text-sm">
            {(expenses ?? []).map((x) => (
              <li key={x.id} className="flex items-center justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {x.expense_date} ·{" "}
                  <span className="rounded bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-700 dark:text-zinc-300">
                    {(x.category as { name?: string } | null)?.name ?? "uncategorized"}
                  </span>{" "}
                  {x.payee && <span className="text-zinc-700 dark:text-zinc-300">{x.payee}</span>}
                  {x.description && <span className="text-zinc-500"> — {x.description}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-red-700 dark:text-red-300">{money(x.amount)}</span>
                  <form action={deleteExpense.bind(null, id, x.id)}>
                    <button className="text-xs text-red-600 dark:text-red-400 hover:underline">✕</button>
                  </form>
                </span>
              </li>
            ))}
            {(expenses ?? []).length === 0 && <li className="py-2 text-zinc-400 dark:text-zinc-600">No expenses logged.</li>}
          </ul>
          {expensesTotal > 0 && (
            <div className="row mt-2 flex justify-between pt-2 text-sm">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">Total Expenses</span>
              <span className="font-bold text-red-700 dark:text-red-300">{money(expensesTotal)}</span>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="card-title">Trip Tracker</h2>
          <form action={addTrip.bind(null, id)} className="mb-4 grid grid-cols-2 gap-2">
            <input type="number" step="0.1" name="miles" placeholder="Miles" required className="input" />
            <input type="date" name="trip_date" className="input" />
            <input name="vehicle" placeholder="Vehicle" list="vehicle-list" className="input" />
            <datalist id="vehicle-list">
              {(vehicles ?? []).map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
            <input name="notes" placeholder="Notes (e.g. venue walkthrough)" className="input" />
            <div className="col-span-2">
              <SaveButton className="btn-primary px-5 py-2 text-xs" savedLabel="Done">Log Trip</SaveButton>
            </div>
          </form>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06] text-sm">
            {(trips ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {t.trip_date}
                  {(t.vehicle as { name?: string } | null)?.name && (
                    <span className="ml-2 rounded bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-700 dark:text-zinc-300">
                      {(t.vehicle as { name?: string }).name}
                    </span>
                  )}
                  {t.notes && <span className="text-zinc-500"> — {t.notes}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{Number(t.miles).toFixed(1)} mi</span>
                  <form action={deleteTrip.bind(null, id, t.id)}>
                    <button className="text-xs text-red-600 dark:text-red-400 hover:underline">✕</button>
                  </form>
                </span>
              </li>
            ))}
            {(trips ?? []).length === 0 && <li className="py-2 text-zinc-400 dark:text-zinc-600">No trips logged.</li>}
          </ul>
          {totalMiles > 0 && (
            <div className="row mt-2 flex justify-between pt-2 text-sm">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">Total Miles</span>
              <span className="font-bold">{totalMiles.toFixed(1)} mi</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* ---------- TAB: Vendors ---------- */
  type EventVendorRow = {
    id: string;
    role: string;
    notes: string | null;
    vendor: { id: string; company_name: string; category: string | null } | null;
  };
  const vendorRows = (eventVendors ?? []) as unknown as EventVendorRow[];
  const linkedVendorIds = new Set(vendorRows.map((v) => v.vendor?.id));
  const addableVendors = (vendorsList ?? []).filter((v) => !linkedVendorIds.has(v.id));

  const vendorsTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {vendorRows.map((ev) => (
          <div key={ev.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                  <Link href={`/vendors/${ev.vendor?.id}`} className="hover:text-brand hover:underline dark:hover:text-brand-lighter">
                    {ev.vendor?.company_name ?? "(unknown vendor)"}
                  </Link>
                </h2>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="rounded bg-black/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
                    {ev.role}
                  </span>
                  {ev.vendor?.category && (
                    <span className="text-xs text-zinc-500">{ev.vendor.category}</span>
                  )}
                </div>
                {ev.notes && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{ev.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-3 text-xs">
                <Link href={`/vendors/${ev.vendor?.id}`} className="font-semibold text-brand hover:underline dark:text-brand-lighter">
                  Open →
                </Link>
                <form action={removeEventVendor.bind(null, id, ev.id)}>
                  <button className="font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>
                </form>
              </div>
            </div>
          </div>
        ))}
        {vendorRows.length === 0 && (
          <div className="card p-5">
            <p className="text-sm text-zinc-500">No vendors on this event yet — add who you&apos;re working with below.</p>
          </div>
        )}
      </div>

      <div className="card max-w-2xl p-5">
        <h2 className="card-title">Add Vendor To Event</h2>
        <form action={addEventVendor.bind(null, id)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label className="label-xs">Vendor</label>
            <select name="vendor_id" required className="input w-full">
              <option value="">Select…</option>
              {addableVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.company_name}
                  {v.category ? ` — ${v.category}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-40">
            <label className="label-xs">Role On This Event</label>
            <input name="role" defaultValue="Vendor" list="vendor-roles" className="input w-full" />
            <datalist id="vendor-roles">
              {["Photographer", "Videographer", "Wedding Planner", "Florist", "Caterer", "Venue Coordinator", "Hair & Makeup", "Officiant", "Rentals"].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div className="min-w-44 flex-1">
            <label className="label-xs">Notes</label>
            <input name="notes" placeholder="e.g. arrives at 2 PM" className="input w-full" />
          </div>
          <SaveButton savedLabel="Added">Add</SaveButton>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          Vendor not in the directory yet? <Link href="/vendors" className="text-brand dark:text-brand-lighter hover:underline">Add them in Vendors</Link> first.
        </p>
      </div>
    </div>
  );

  /* ---------- TAB: Logistics ---------- */
  type EquipRow = {
    id: string;
    quantity: number;
    notes: string | null;
    packed: boolean;
    checked_out_at: string | null;
    checked_in_at: string | null;
    item: { id: string; name: string; category: string | null; qr_code: string } | null;
    system: { id: string; name: string; description: string | null; qr_code: string } | null;
  };
  const equipRows = (eventEquipment ?? []) as unknown as EquipRow[];
  const packedCount = equipRows.filter((r) => r.packed).length;
  const logisticsNotes = (notes ?? []).filter((n) => n.kind === "logistics");

  const logisticsTab = (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="card-title mb-0">Equipment Checklist</h2>
          <span className="text-xs font-bold text-zinc-500">
            {packedCount}/{equipRows.length} packed
          </span>
        </div>

        <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {equipRows.map((r) => {
            const name = r.item?.name ?? r.system?.name ?? "?";
            const isSystem = !!r.system;
            return (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <form action={toggleEquipmentPacked.bind(null, id, r.id, !r.packed)}>
                      <button
                        title={r.packed ? "Packed — click to unpack" : "Mark as packed"}
                        className={`flex size-6 items-center justify-center rounded-md border text-xs font-black transition-colors ${
                          r.packed
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-zinc-300 text-transparent hover:border-brand dark:border-white/20"
                        }`}
                      >
                        ✓
                      </button>
                    </form>
                    <div>
                      <span className={`text-sm font-semibold ${r.packed ? "text-zinc-400 line-through dark:text-zinc-600" : ""}`}>
                        {name}
                        {r.quantity > 1 && <span className="ml-1 text-xs text-zinc-500">×{r.quantity}</span>}
                      </span>
                      <span className="ml-2 rounded bg-black/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
                        {isSystem ? "System" : r.item?.category ?? "Item"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {r.checked_out_at ? (
                      <span className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-700 dark:text-amber-300">
                        Out {new Date(r.checked_out_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <form action={markEquipment.bind(null, id, r.id, "checked_out_at")}>
                        <button className="rounded bg-black/[0.06] px-2 py-1 font-semibold text-zinc-600 hover:bg-brand/20 dark:bg-white/[0.07] dark:text-zinc-400">
                          Check Out
                        </button>
                      </form>
                    )}
                    {r.checked_in_at ? (
                      <span className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
                        In {new Date(r.checked_in_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <form action={markEquipment.bind(null, id, r.id, "checked_in_at")}>
                        <button className="rounded bg-black/[0.06] px-2 py-1 font-semibold text-zinc-600 hover:bg-brand/20 dark:bg-white/[0.07] dark:text-zinc-400">
                          Check In
                        </button>
                      </form>
                    )}
                    <form action={removeEventEquipment.bind(null, id, r.id)}>
                      <button className="px-1 font-semibold text-red-600 hover:underline dark:text-red-400">✕</button>
                    </form>
                  </div>
                </div>
                <form action={updateEquipmentNotes.bind(null, id, r.id)} className="mt-1.5 flex gap-2 pl-9">
                  <input
                    name="notes"
                    defaultValue={r.notes ?? ""}
                    placeholder="Equipment note — e.g. bring backup needles, left fader sticky…"
                    className="input w-full max-w-md py-1 text-xs"
                  />
                  <button className="btn-ghost px-2.5 py-0.5 text-[10px]">Save</button>
                </form>
              </li>
            );
          })}
          {equipRows.length === 0 && (
            <li className="py-4 text-sm text-zinc-500">Nothing assigned yet — build the load list below.</li>
          )}
        </ul>

        <h3 className="label-xs mt-4">Assign Equipment</h3>
        <form action={addEventEquipment.bind(null, id)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1">
            <select name="equipment_ref" required className="input w-full">
              <option value="">Select item or system…</option>
              {(equipmentSystems ?? []).length > 0 && (
                <optgroup label="Systems (racks & cases)">
                  {(equipmentSystems ?? []).map((s) => (
                    <option key={s.id} value={`system:${s.id}`}>📦 {s.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Items">
                {(equipmentItems ?? []).map((i) => (
                  <option key={i.id} value={`item:${i.id}`}>
                    {i.name}
                    {i.category ? ` — ${i.category}` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <input type="number" name="quantity" defaultValue={1} min={1} className="input w-16" title="Quantity" />
          <input name="notes" placeholder="Note (optional)" className="input w-48" />
          <SaveButton className="btn-primary px-4 py-2 text-xs" savedLabel="Added">Add</SaveButton>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          Manage your gear list in <Link href="/equipment" className="text-brand dark:text-brand-lighter hover:underline">Equipment</Link>.
        </p>
      </div>

      <div className="card max-w-3xl p-5">
        <h2 className="card-title">Logistics Notes</h2>
        <form action={addLogisticsNote.bind(null, id)} className="mb-3 flex gap-2">
          <input name="body" placeholder="e.g. Loading dock is on the north side, freight elevator code 4421…" className="input w-full" />
          <SaveButton className="btn-primary px-5" savedLabel="Added">Add</SaveButton>
        </form>
        <ul className="space-y-2 text-sm">
          {logisticsNotes.map((n) => (
            <li key={n.id} className="rounded-lg bg-black/[0.04] p-3 dark:bg-white/[0.05]">
              <span className="text-zinc-700 dark:text-zinc-300">{n.body}</span>
              <div className="mt-1 text-[11px] text-zinc-500">
                {n.author_name ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
              </div>
            </li>
          ))}
          {logisticsNotes.length === 0 && <li className="text-sm text-zinc-500">No logistics notes yet.</li>}
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
        <p className="mb-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-100">{event.internal_notes}</p>
      )}
      <ul className="space-y-2 text-sm">
        {internalNotes.map((n: { id: string; body: string; created_at: string; author_name?: string | null }) => (
          <li key={n.id} className="rounded-lg bg-black/[0.04] dark:bg-white/[0.05] p-3">
            <span className="text-zinc-700 dark:text-zinc-300">{n.body}</span>
            <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
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

  /* ---------- header helpers ---------- */
  // parse date parts from the string to avoid timezone shifts
  const dateParts = event.event_date ? event.event_date.split("-").map(Number) : null;
  const dateObj = dateParts ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]) : null;
  const primaryClient =
    (eventClients ?? []).find((ec) => ec.is_primary)?.client ?? event.client ?? null;
  const primaryClientName = primaryClient
    ? `${(primaryClient as { first_name: string }).first_name} ${(primaryClient as { last_name: string }).last_name}`
    : null;
  const primaryOrg = (primaryClient as { organization?: string | null } | null)?.organization ?? null;

  return (
    <div className="max-w-6xl">
      {/* ---------- STICKY HEADER ---------- */}
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 border-b border-zinc-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0b0913]/90 px-6 pt-4 pb-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {/* calendar date badge */}
            <div className="w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-300 dark:border-white/15 text-center shadow-lg">
              <div className="bg-gradient-to-r from-brand to-brand-light py-0.5 text-[10px] font-black tracking-widest text-white uppercase">
                {dateObj ? dateObj.toLocaleString("en-US", { month: "short" }) : "TBD"}
              </div>
              <div className="bg-black/[0.05] dark:bg-white/[0.06] pt-0.5 text-[8px] font-bold tracking-widest text-zinc-500 uppercase">
                {dateObj ? dateObj.toLocaleString("en-US", { weekday: "long" }) : "—"}
              </div>
              <div className="bg-black/[0.05] dark:bg-white/[0.06] text-xl leading-6 font-black text-zinc-900 dark:text-white">
                {dateObj ? dateObj.getDate() : "?"}
              </div>
              <div className="bg-black/[0.05] dark:bg-white/[0.06] pb-1 text-[9px] font-bold text-zinc-500">
                {dateObj ? dateObj.getFullYear() : ""}
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-900 dark:text-white">
                {event.name || "(unnamed event)"}
                {eventNumber && <span className="ml-2 text-xs font-semibold text-zinc-400 dark:text-zinc-600">#{eventNumber}</span>}
              </h1>
              <p className="text-xs text-zinc-500">
                Event Date:{" "}
                <span className="text-zinc-700 dark:text-zinc-300">
                  {dateObj
                    ? dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                    : "not set"}
                </span>
              </p>
              <p className="text-xs text-zinc-500">
                Client: <span className="text-zinc-700 dark:text-zinc-300">{primaryClientName ?? "—"}</span>
                {primaryOrg && (
                  <>
                    {" "}· Organization: <span className="text-zinc-700 dark:text-zinc-300">{primaryOrg}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                Venue:{" "}
                <span className="text-zinc-700 dark:text-zinc-300">
                  {event.venue ? `${event.venue.name}${event.venue.city ? ` - ${event.venue.city}, ${event.venue.state ?? ""}` : ""}` : "—"}
                </span>
              </p>
            </div>
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
            <span className="hidden rounded-lg border border-zinc-300 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-1.5 text-sm font-bold text-zinc-900 dark:text-white md:inline">
              {money(balance)} <span className="text-xs font-medium text-zinc-500">due</span>
            </span>
          </div>
        </div>
      </div>

      <BookingHelperBar
        eventId={id}
        statusId={event.status_id}
        helpers={helpers ?? []}
        ranHelperIds={(helperRuns ?? []).map((r) => r.helper_id)}
        hasPayments={(payments ?? []).length > 0}
      />

      {/* ---------- OVERVIEW PANELS ---------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title mb-0">Event Details</h2>
            {eventNumber && <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600">EVENT ID: {eventNumber}</span>}
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Type:</dt><dd>{event.event_type?.name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Name:</dt><dd className="truncate pl-3">{event.name || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Setup:</dt><dd>{fmtTime(event.setup_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Times:</dt><dd>{fmtTime(event.start_time)} / {fmtTime(event.end_time)}</dd></div>
          </dl>
        </div>

        <div className="card p-4">
          <h2 className="card-title">Financials Overview</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Package:</dt><dd className="truncate pl-3">{event.package?.name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Total Fee:</dt><dd className="font-semibold">{money(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Payments Received:</dt><dd className="text-emerald-600 dark:text-emerald-400">{money(paid)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Outstanding Balance:</dt><dd className="font-bold text-zinc-900 dark:text-white">{money(balance)}</dd></div>
          </dl>
        </div>

        <div className="card p-4">
          <h2 className="card-title">Status Details</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Salesperson:</dt><dd>{event.salesperson ? `${event.salesperson.first_name} ${event.salesperson.last_name}` : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Inquiry Source:</dt><dd>{event.inquiry_source?.name ?? "—"}</dd></div>
          </dl>
          {event.status && (
            <div
              className="mt-3 rounded-lg py-1.5 text-center text-sm font-bold"
              style={{ backgroundColor: event.status.color, color: event.status.text_color }}
            >
              {event.status.name}
            </div>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "client", label: "Client", badge: (eventClients ?? []).length, content: clientTab },
          { id: "details", label: "Details", content: detailsTab },
          { id: "booking", label: "Booking", content: bookingTab },
          { id: "financials", label: "Financials", badge: balance > 0 ? money(balance) : undefined, content: financialsTab },
          { id: "staff", label: "Staff", badge: (staff ?? []).length, content: staffTab },
          { id: "vendors", label: "Vendors", badge: vendorRows.length, content: vendorsTab },
          { id: "logistics", label: "Logistics", badge: equipRows.length ? `${packedCount}/${equipRows.length}` : undefined, content: logisticsTab },
          { id: "notes", label: "Notes", badge: internalNotes.length, content: notesTab },
        ]}
      />

      <div className="mt-10 flex justify-end border-t border-zinc-200 pt-4 dark:border-white/[0.06]">
        <form action={deleteEvent.bind(null, id)}>
          <button className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400">
            Delete This Event
          </button>
        </form>
      </div>
    </div>
  );
}
