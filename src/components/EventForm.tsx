import type { XEvent } from "@/lib/types";

type Option = { id: string; name: string };
type ClientOption = { id: string; first_name: string; last_name: string };

export default function EventForm({
  event,
  action,
  clients,
  venues,
  packages,
  statuses,
  eventTypes,
  inquirySources,
}: {
  event?: Partial<XEvent>;
  action: (formData: FormData) => Promise<void>;
  clients: ClientOption[];
  venues: Option[];
  packages: Option[];
  statuses: Option[];
  eventTypes: Option[];
  inquirySources: Option[];
}) {
  const cf = (event?.custom_fields ?? {}) as Record<string, string>;

  const input =
    "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none bg-white";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500";

  return (
    <form action={action} className="space-y-6">
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Details
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className={label}>Event Name</label>
            <input name="name" defaultValue={event?.name ?? ""} className={input} placeholder="Eric & Sam's Wedding" />
          </div>
          <div>
            <label className={label}>Event Type</label>
            <select name="event_type_id" defaultValue={event?.event_type_id ?? ""} className={input}>
              <option value="">—</option>
              {eventTypes.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Client</label>
            <select name="client_id" defaultValue={event?.client_id ?? ""} className={input}>
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Event Date</label>
            <input type="date" name="event_date" defaultValue={event?.event_date ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Guest Count</label>
            <input type="number" name="guest_count" defaultValue={event?.guest_count ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Setup Time</label>
            <input type="time" name="setup_time" defaultValue={event?.setup_time ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Start Time</label>
            <input type="time" name="start_time" defaultValue={event?.start_time ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>End Time</label>
            <input type="time" name="end_time" defaultValue={event?.end_time ?? ""} className={input} />
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Booking
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={label}>Status</label>
            <select name="status_id" defaultValue={event?.status_id ?? ""} className={input}>
              <option value="">—</option>
              {statuses.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Inquiry Source</label>
            <select name="inquiry_source_id" defaultValue={event?.inquiry_source_id ?? ""} className={input}>
              <option value="">—</option>
              {inquirySources.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Initial Contact</label>
            <input type="date" name="initial_contact_date" defaultValue={event?.initial_contact_date ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Contract Sent</label>
            <input type="date" name="contract_sent_date" defaultValue={event?.contract_sent_date ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Contract Due</label>
            <input type="date" name="contract_due_date" defaultValue={event?.contract_due_date ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Contract Signed</label>
            <input type="date" name="contract_signed_date" defaultValue={event?.contract_signed_date ?? ""} className={input} />
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Financials
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={label}>Package</label>
            <select name="package_id" defaultValue={event?.package_id ?? ""} className={input}>
              <option value="">—</option>
              {packages.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Package Price Override ($)</label>
            <input type="number" step="0.01" name="package_price_override" defaultValue={event?.package_price_override ?? ""} className={input} placeholder="blank = package default" />
          </div>
          <div>
            <label className={label}>Deposit ($)</label>
            <input type="number" step="0.01" name="deposit_value" defaultValue={event?.deposit_value ?? 0} className={input} />
          </div>
          <div>
            <label className={label}>Overtime Fee ($)</label>
            <input type="number" step="0.01" name="overtime_fee" defaultValue={event?.overtime_fee ?? 0} className={input} />
          </div>
          <div>
            <label className={label}>Travel Fee ($)</label>
            <input type="number" step="0.01" name="travel_fee" defaultValue={event?.travel_fee ?? 0} className={input} />
          </div>
          <div>
            <label className={label}>Discount 1 ($)</label>
            <input type="number" step="0.01" name="discount1_amount" defaultValue={event?.discount1_amount ?? 0} className={input} />
          </div>
          <div>
            <label className={label}>Discount 2 ($)</label>
            <input type="number" step="0.01" name="discount2_amount" defaultValue={event?.discount2_amount ?? 0} className={input} />
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Venue
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={label}>Venue</label>
            <select name="venue_id" defaultValue={event?.venue_id ?? ""} className={input}>
              <option value="">—</option>
              {venues.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Custom Fields
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Google Drive Timeline Link</label>
            <input name="cf_gdrive_timeline" defaultValue={cf.gdrive_timeline ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Google Drive Folder Link</label>
            <input name="cf_gdrive_folder" defaultValue={cf.gdrive_folder ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Vibo Link</label>
            <input name="cf_vibo_link" defaultValue={cf.vibo_link ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>Photo Booth Gallery</label>
            <input name="cf_photobooth_gallery" defaultValue={cf.photobooth_gallery ?? ""} className={input} />
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 border-b border-zinc-100 pb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
          Internal Notes
        </h2>
        <textarea name="internal_notes" defaultValue={event?.internal_notes ?? ""} rows={3} className={input} />
      </section>

      <button
        type="submit"
        className="rounded-md bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
      >
        Save Event
      </button>
    </form>
  );
}
