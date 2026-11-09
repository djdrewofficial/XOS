/* Event page for FIELD STAFF (employee / marketing tier): assigned events only,
   money-free. Data comes from fieldStaffLoader (the xos_fs_* views). No Booking
   or Comms tab, no prices, fees, balances or payments anywhere; the Staff tab
   shows the viewer's OWN wage only. The office event page (page.tsx) is
   unchanged. */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/auth";
import { money } from "@/lib/types";
import UrlTabs from "@/components/UrlTabs";
import BookingHelperBar from "@/components/BookingHelperBar";
import StaffCheckIn from "@/components/StaffCheckIn";
import { DoNotPlayPanel, EventSectionNotes } from "@/components/planner/SectionMomentNotes";
import { addEventNote } from "../actions";
import { FIELD_STAFF_TABS, loadFieldStaffEvent, type FieldStaffTab } from "./fieldStaffLoader";

const fmtTime = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
};

/** Catalog descriptions may be rich text — show them as plain text (no raw HTML). */
const plain = (html: string | null | undefined) =>
  (html ?? "").replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

const tel = (p: string | null | undefined) => (p ? `tel:${p.replace(/[^\d+]/g, "")}` : undefined);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function FieldStaffEventPage({
  supabase,
  me,
  id,
  tab,
}: {
  supabase: SupabaseClient;
  me: Me;
  id: string;
  tab?: string;
}) {
  const activeTab: FieldStaffTab = (FIELD_STAFF_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as FieldStaffTab)
    : "client";
  const data = await loadFieldStaffEvent(supabase, me, id, activeTab);
  if (!data) notFound();
  const { event, clients, staff, addons, vendors, equipment, notes, files, planner } = data;
  const canEdit = me.can.events === "edit";
  const dateObj = event.event_date ? new Date(`${event.event_date}T12:00:00`) : null;
  const mine = staff.filter((s) => s.employee_id === me.employeeId);
  const internalNotes = notes.filter((n) => n.kind !== "logistics");
  const logisticsNotes = notes.filter((n) => n.kind === "logistics");
  const venue = event.venue;
  const clientList = clients.length
    ? clients
    : event.client
      ? [{ id: event.client.id, role: null, is_primary: true, client: event.client }]
      : [];

  const clientTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      {clientList.map((ec) => {
        const c = ec.client;
        if (!c) return null;
        return (
          <div key={ec.id} className="card p-5">
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">
              {`${c.first_name} ${c.last_name}`.trim()}
              {ec.is_primary && <span className="ml-2 chip bg-brand/10 text-brand dark:text-brand-lighter">Primary</span>}
            </h2>
            {ec.role && <p className="text-xs text-zinc-500">{ec.role}</p>}
            <dl className="mt-3 space-y-1 text-sm">
              {c.organization && <Row label="Organization">{c.organization}</Row>}
              <Row label="Cell">{c.cell_phone ? <a href={tel(c.cell_phone)} className="text-brand hover:underline">{c.cell_phone}</a> : "—"}</Row>
              <Row label="Email">{c.email ? <a href={`mailto:${c.email}`} className="text-brand hover:underline">{c.email}</a> : "—"}</Row>
              {event.use_client_address && c.mailing_address && <Row label="Address">{c.mailing_address}</Row>}
            </dl>
          </div>
        );
      })}
      {clientList.length === 0 && <p className="text-sm text-zinc-500">No client on this event.</p>}
    </div>
  );

  const detailsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Event Details</h2>
        <dl className="space-y-1 text-sm">
          <Row label="Type">{event.event_type?.name ?? "—"}</Row>
          <Row label="Name">{event.name || "—"}</Row>
          <Row label="Date">{dateObj ? dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "—"}</Row>
          <Row label="Setup">{fmtTime(event.setup_time)}</Row>
          <Row label="Start / End">{fmtTime(event.start_time)} / {fmtTime(event.end_time)}</Row>
          <Row label="Guests">{event.guest_count ?? "—"}</Row>
        </dl>
      </div>
      <div className="card p-5">
        <h2 className="card-title">Venue</h2>
        {venue ? (
          <dl className="space-y-1 text-sm">
            <Row label="Name">{venue.name}</Row>
            {event.venue_room?.name && <Row label="Room">{event.venue_room.name}</Row>}
            <Row label="Address">
              {[venue.address, venue.city, venue.state, venue.zip].filter(Boolean).join(", ") || "—"}
            </Row>
            {venue.contact_name && <Row label="Contact">{venue.contact_name}</Row>}
            {venue.phone && <Row label="Phone"><a href={tel(venue.phone)} className="text-brand hover:underline">{venue.phone}</a></Row>}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">{event.use_client_address ? "At the client's address (see Client tab)." : "No venue set."}</p>
        )}
      </div>
    </div>
  );

  // Inclusions only — what's being delivered, never what it costs.
  const financialsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Package</h2>
        <p className="font-semibold">{event.package?.name ?? "No package"}</p>
        {event.package?.included_hours != null && (
          <p className="text-xs text-zinc-500">{event.package.included_hours} hours included</p>
        )}
        {(event.package_description_override ?? event.package?.description) && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
            {plain(event.package_description_override ?? event.package?.description)}
          </p>
        )}
      </div>
      <div className="card p-5">
        <h2 className="card-title">Add-Ons</h2>
        {addons.length === 0 && <p className="text-sm text-zinc-500">No add-ons.</p>}
        <ul className="space-y-3 text-sm">
          {addons.map((a) => (
            <li key={a.id}>
              <span className="font-semibold">{a.name ?? "Add-on"}</span>
              {a.quantity > 1 && <span className="text-zinc-500"> ×{a.quantity}</span>}
              {a.description && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{plain(a.description)}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const staffTab = (
    <div className="space-y-5">
      {mine.length > 0 && (
        <div className="card p-5">
          <h2 className="card-title">My Assignment</h2>
          <ul className="space-y-3 text-sm">
            {mine.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{s.role ?? "Staff"}</div>
                  <div className="text-xs text-zinc-500">
                    {fmtTime(s.start_time ?? event.start_time)} – {fmtTime(s.end_time ?? event.end_time)}
                    {s.flat_wage != null && Number(s.flat_wage) > 0 && <> · Wage {money(Number(s.flat_wage))}</>}
                  </div>
                  {s.notes && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{s.notes}</p>}
                </div>
                <StaffCheckIn eventStaffId={s.id} checkedInAt={s.checked_in_at} checkedOutAt={s.checked_out_at} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="row">
                <td className="px-4 py-2">
                  {s.stage_name || `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "Staff"}
                </td>
                <td className="px-4 py-2">{s.role ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {fmtTime(s.start_time ?? event.start_time)} – {fmtTime(s.end_time ?? event.end_time)}
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">No staff assigned.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const vendorsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      {vendors.map((v) => (
        <div key={v.id} className="card p-5">
          <h2 className="text-base font-bold text-zinc-900 dark:text-white">{v.vendor?.company_name ?? "(unknown vendor)"}</h2>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded bg-black/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-white/10 dark:text-zinc-300">{v.role}</span>
            {v.vendor?.category && <span className="text-xs text-zinc-500">{v.vendor.category}</span>}
          </div>
          {v.notes && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{v.notes}</p>}
        </div>
      ))}
      {vendors.length === 0 && <p className="text-sm text-zinc-500">No vendors on this event.</p>}
    </div>
  );

  const logisticsTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">Equipment</h2>
        {equipment.length === 0 && <p className="text-sm text-zinc-500">No equipment listed.</p>}
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/[0.06]">
          {equipment.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>
                {r.item?.name ?? r.system?.name ?? "?"}
                {r.quantity > 1 && <span className="text-zinc-500"> ×{r.quantity}</span>}
                {r.notes && <span className="block text-xs text-zinc-500">{r.notes}</span>}
              </span>
              <span className={`text-xs font-semibold ${r.packed ? "text-emerald-600" : "text-zinc-400"}`}>{r.packed ? "Packed" : "Not packed"}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-5">
        <h2 className="card-title">Load-In &amp; Driving</h2>
        <dl className="space-y-2 text-sm">
          <div><dt className="label-xs">Load-in</dt><dd className="whitespace-pre-wrap">{venue?.load_in_details || "—"}</dd></div>
          <div><dt className="label-xs">Driving notes</dt><dd className="whitespace-pre-wrap">{venue?.driving_notes || "—"}</dd></div>
          {venue?.notes && <div><dt className="label-xs">Venue notes</dt><dd className="whitespace-pre-wrap">{venue.notes}</dd></div>}
        </dl>
        {logisticsNotes.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {logisticsNotes.map((n) => (
              <li key={n.id} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">{n.body}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const documentsTab = (
    <div className="card max-w-2xl p-5">
      <h2 className="card-title">Timeline</h2>
      {files.length === 0 && <p className="text-sm text-zinc-500">No timeline uploaded yet.</p>}
      <ul className="space-y-1 text-sm">
        {files.map((f) => (
          <li key={f.id}>
            {f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">📄 {f.name}</a>
            ) : (
              <span>📄 {f.name}</span>
            )}
            <span className="ml-2 text-xs text-zinc-400">{f.created_at.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  const viboLink = (event.custom_fields ?? {}).vibo_link as string | undefined;
  const notesTab = (
    <div className="max-w-3xl space-y-6">
      {planner && event.planning_seeded && (
        <div className="card p-5">
          <h2 className="card-title">Event Planner</h2>
          <EventSectionNotes eventId={id} sections={planner.sections} canEdit={canEdit} />
        </div>
      )}
      {!event.planning_seeded && viboLink && (
        <div className="card p-5">
          <h2 className="card-title">Event Planner</h2>
          <a href={viboLink} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">Open Vibo →</a>
        </div>
      )}
      {planner && (event.planning_seeded || planner.doNotPlaySongs.length > 0 || planner.doNotPlayText) && (
        <DoNotPlayPanel eventId={id} text={planner.doNotPlayText} songs={planner.doNotPlaySongs} canEdit={canEdit} />
      )}
      <div className="card p-5">
        <h2 className="card-title">Notes</h2>
        {canEdit && (
          <form action={addEventNote.bind(null, id)} className="mb-4 flex gap-2">
            <input name="body" placeholder="Add a note…" className="input w-full" />
            <button className="btn-primary px-5">Add</button>
          </form>
        )}
        {event.internal_notes && (
          <p className="mb-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-100">{event.internal_notes}</p>
        )}
        <ul className="space-y-2 text-sm">
          {internalNotes.map((n) => (
            <li key={n.id} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
              {n.body}
              <span className="ml-2 text-xs text-zinc-400">{n.created_at.slice(0, 10)}</span>
            </li>
          ))}
          {internalNotes.length === 0 && !event.internal_notes && <li className="text-zinc-500">No notes yet.</li>}
        </ul>
      </div>
    </div>
  );

  const primary = clientList[0]?.client ?? null;

  return (
    <div className="max-w-[1700px]">
      <div className="sticky top-14 z-30 -mx-4 -mt-4 mb-5 border-b border-zinc-200 bg-white/85 px-4 pt-4 pb-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0b0913]/90 md:-mx-6 md:-mt-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-zinc-900 dark:text-white">
              {event.name || "(unnamed event)"}
              {event.event_number && <span className="ml-2 text-xs font-semibold text-zinc-400 dark:text-zinc-600">#{event.event_number}</span>}
            </h1>
            <p className="text-xs text-zinc-500">
              {dateObj ? dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Date not set"}
              {" · "}Client: <span className="text-zinc-700 dark:text-zinc-300">{primary ? `${primary.first_name} ${primary.last_name}`.trim() : "—"}</span>
              {" · "}Venue: <span className="text-zinc-700 dark:text-zinc-300">{venue?.name ?? "—"}</span>
            </p>
          </div>
          {event.status && (
            <span className="status-chip px-3 py-1.5 text-sm" style={{ backgroundColor: event.status.color, color: event.status.text_color }}>
              {event.status.name}
            </span>
          )}
        </div>
      </div>

      {data.helpers.length > 0 && (
        <BookingHelperBar
          eventId={id}
          statusId={event.status_id}
          helpers={data.helpers}
          ranHelperIds={data.ranHelperIds}
          hasPayments={data.hasPayments}
        />
      )}

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title mb-0">Event Details</h2>
            {event.event_number && <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600">EVENT ID: {event.event_number}</span>}
          </div>
          <dl className="space-y-1 text-sm">
            <Row label="Type:">{event.event_type?.name ?? "—"}</Row>
            <Row label="Setup:">{fmtTime(event.setup_time)}</Row>
            <Row label="Times:">{fmtTime(event.start_time)} / {fmtTime(event.end_time)}</Row>
          </dl>
        </div>
        <div className="card p-4">
          <h2 className="card-title">Status Details</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Salesperson:">{event.salesperson ? `${event.salesperson.first_name} ${event.salesperson.last_name}` : "—"}</Row>
            <Row label="Status:">{event.status?.name ?? "—"}</Row>
          </dl>
        </div>
      </div>

      <UrlTabs
        active={activeTab}
        basePath={`/events/${id}`}
        tabs={[
          { id: "client", label: "Client", badge: clientList.length, content: clientTab },
          { id: "details", label: "Details", content: detailsTab },
          { id: "financials", label: "Inclusions", content: financialsTab },
          { id: "staff", label: "Staff", badge: staff.length, content: staffTab },
          { id: "vendors", label: "Vendors", badge: vendors.length, content: vendorsTab },
          { id: "logistics", label: "Logistics", content: logisticsTab },
          { id: "documents", label: "Documents", content: documentsTab },
          { id: "notes", label: "Planning / Notes", content: notesTab },
        ]}
      />

      <p className="mt-8 text-xs text-zinc-400">
        <Link href="/events" className="hover:underline">← My events</Link>
      </p>
    </div>
  );
}
