import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import Tabs from "@/components/Tabs";
import {
  updateEmployeeGeneral,
  updateEmployeeContact,
  updateEmployeeWages,
  uploadEmployeePhoto,
  addTimeOff,
  setTimeOffStatus,
  deleteTimeOff,
} from "../actions";

export const dynamic = "force-dynamic";

const TIERS = ["master_admin", "admin", "salesperson", "employee"] as const;

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: emp }, { data: assignments }, { data: timeOff }] = await Promise.all([
    supabase.from("employees").select("*").eq("id", id).single(),
    supabase
      .from("event_staff")
      .select(
        "*, event:events(id, name, event_date, client:clients(first_name, last_name), event_type:event_types(name), status:event_statuses(name, color, text_color, is_booked_group), venue:venues(name))"
      )
      .eq("employee_id", id),
    supabase
      .from("employee_time_off")
      .select("*")
      .eq("employee_id", id)
      .order("start_date", { ascending: false }),
  ]);

  if (!emp) notFound();

  type Assignment = {
    id: string;
    role: string;
    flat_wage: number;
    confirmed_at: string | null;
    paid_at: string | null;
    event: {
      id: string;
      name: string;
      event_date: string | null;
      client: { first_name: string; last_name: string } | null;
      event_type: { name: string } | null;
      status: { name: string; color: string; text_color: string; is_booked_group: boolean } | null;
      venue: { name: string } | null;
    } | null;
  };
  const rows = ((assignments ?? []) as unknown as Assignment[])
    .filter((a) => a.event)
    .sort((a, b) => (b.event!.event_date ?? "").localeCompare(a.event!.event_date ?? ""));

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((a) => a.event!.event_date && a.event!.event_date >= today)
    .sort((a, b) => (a.event!.event_date ?? "").localeCompare(b.event!.event_date ?? ""));
  const nextEvent = upcoming[0] ?? null;
  const bookedCount = upcoming.filter((a) => a.event!.status?.is_booked_group).length;
  const unpaidWages = rows
    .filter((a) => !a.paid_at && Number(a.flat_wage) > 0)
    .reduce((s, a) => s + Number(a.flat_wage), 0);
  const totalWages = rows.reduce((s, a) => s + Number(a.flat_wage), 0);

  const photoUrl = emp.photo_path
    ? supabase.storage.from("staff").getPublicUrl(emp.photo_path).data.publicUrl
    : null;

  /* ---------- TAB: General ---------- */
  const generalTab = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="card-title">General</h2>
        <form action={updateEmployeeGeneral.bind(null, id)} className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-xs">First Name</label>
            <input name="first_name" defaultValue={emp.first_name} required className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Last Name</label>
            <input name="last_name" defaultValue={emp.last_name} className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Stage Name</label>
            <input name="stage_name" defaultValue={emp.stage_name ?? ""} className="input w-full" placeholder="DJ Drew Segura" />
          </div>
          <div>
            <label className="label-xs">Access Level</label>
            <select name="permission_tier" defaultValue={emp.permission_tier} className="input w-full">
              {TIERS.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Start / Hired Date</label>
            <input type="date" name="hired_date" defaultValue={emp.hired_date ?? ""} className="input w-full" />
          </div>
          <div>
            <label className="label-xs">Began Profession In</label>
            <input type="number" name="profession_since" defaultValue={emp.profession_since ?? ""} className="input w-full" placeholder="2016" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Biography</label>
            <textarea name="bio" rows={3} defaultValue={emp.bio ?? ""} className="input w-full" placeholder="Used on Meet Your DJ emails later…" />
          </div>
          <div className="col-span-2">
            <label className="label-xs">Notes (internal)</label>
            <textarea name="notes" rows={2} defaultValue={emp.notes ?? ""} className="input w-full" />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="is_active" defaultChecked={emp.is_active} className="size-4 accent-brand-light" />
            Active employee
          </label>
          <div className="col-span-2">
            <button className="btn-primary">Save</button>
          </div>
        </form>
      </div>

      <div className="card p-5">
        <h2 className="card-title">Photo</h2>
        <div className="mb-4 flex items-center gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={emp.first_name} className="size-28 rounded-2xl object-cover" />
          ) : (
            <div className="flex size-28 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-light text-3xl font-black text-white">
              {emp.first_name?.[0]}{emp.last_name?.[0]}
            </div>
          )}
          <p className="text-xs text-zinc-500">Shown on their profile and, later, the employee portal and Meet Your DJ emails.</p>
        </div>
        <form action={uploadEmployeePhoto.bind(null, id)} className="flex items-center gap-2">
          <input
            type="file"
            name="photo"
            accept="image/*"
            required
            className="block w-full text-xs text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-brand file:to-brand-light file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:brightness-110"
          />
          <button className="btn-ghost px-4 py-1.5 text-xs">Upload</button>
        </form>
      </div>
    </div>
  );

  /* ---------- TAB: Events ---------- */
  const eventsTab = (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 text-xs font-bold text-zinc-500">
        <span>ALL EVENTS</span>
        <span>{bookedCount} UPCOMING BOOKED / {rows.length} TOTAL</span>
      </div>
      <table className="w-full text-sm">
        <thead className="table-head">
          <tr>
            <th className="px-4 py-2 text-left">Date</th>
            <th className="px-4 py-2 text-left">Event / Client</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Role</th>
            <th className="px-4 py-2 text-right">Wage</th>
            <th className="px-4 py-2 text-center">Confirmed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
              <td className="px-4 py-2 whitespace-nowrap">{a.event!.event_date ?? "—"}</td>
              <td className="px-4 py-2">
                <Link href={`/events/${a.event!.id}`} className="font-medium text-brand dark:text-brand-lighter hover:underline">
                  {a.event!.name ||
                    (a.event!.client ? `${a.event!.client.first_name} ${a.event!.client.last_name}` : "(unnamed)")}
                </Link>
              </td>
              <td className="px-4 py-2">{a.event!.event_type?.name ?? "—"}</td>
              <td className="px-4 py-2">
                {a.event!.status && (
                  <span className="chip" style={{ backgroundColor: a.event!.status.color, color: a.event!.status.text_color }}>
                    {a.event!.status.name}
                  </span>
                )}
              </td>
              <td className="px-4 py-2">{a.role}</td>
              <td className="px-4 py-2 text-right">{money(a.flat_wage)}</td>
              <td className="px-4 py-2 text-center">{a.confirmed_at ? "✓" : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No events assigned yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  /* ---------- TAB: Contact ---------- */
  const contactTab = (
    <div className="card max-w-2xl p-5">
      <h2 className="card-title">Contact &amp; Personal</h2>
      <form action={updateEmployeeContact.bind(null, id)} className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-xs">Email</label>
          <input type="email" name="email" defaultValue={emp.email ?? ""} className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Phone</label>
          <input name="phone" defaultValue={emp.phone ?? ""} className="input w-full" />
        </div>
        <div className="col-span-2">
          <label className="label-xs">Address</label>
          <input name="address" defaultValue={emp.address ?? ""} className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Emergency Contact</label>
          <input name="emergency_contact" defaultValue={emp.emergency_contact ?? ""} className="input w-full" placeholder="Name · relationship · phone" />
        </div>
        <div>
          <label className="label-xs">Birthday</label>
          <input type="date" name="birthday" defaultValue={emp.birthday ?? ""} className="input w-full" />
        </div>
        <div className="col-span-2">
          <button className="btn-primary">Save</button>
        </div>
      </form>
    </div>
  );

  /* ---------- TAB: Wages ---------- */
  const wagesTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="card-title">Pay Settings</h2>
          <form action={updateEmployeeWages.bind(null, id)} className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-xs">Hourly Rate ($)</label>
              <input type="number" step="0.01" name="hourly_rate" defaultValue={emp.hourly_rate ?? ""} className="input w-full" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="check_in_required" defaultChecked={emp.check_in_required} className="size-4 accent-brand-light" />
              Check-in/out required
            </label>
            <div>
              <label className="label-xs">Add-On Commission (%)</label>
              <input type="number" step="0.1" name="addon_commission_pct" defaultValue={emp.addon_commission_pct ?? 0} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Sales Commission (%)</label>
              <input type="number" step="0.1" name="sales_commission_pct" defaultValue={emp.sales_commission_pct ?? 0} className="input w-full" />
            </div>
            <div className="col-span-2">
              <button className="btn-primary">Save</button>
            </div>
          </form>
        </div>
        <div className="card p-5">
          <h2 className="card-title">Totals</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">All-Time Event Wages</dt><dd className="font-semibold">{money(totalWages)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Unpaid Wages</dt><dd className="font-bold text-amber-700 dark:text-amber-300">{money(unpaidWages)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-zinc-500">
            Per-event wages are set on each event&apos;s Staff tab. Punch-based hourly auto-calc comes with the employee portal.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <h2 className="card-title px-4 pt-4">Wage History</h2>
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Event</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-right">Wage</th>
              <th className="px-4 py-2 text-center">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((a) => Number(a.flat_wage) > 0).map((a) => (
              <tr key={a.id} className="row">
                <td className="px-4 py-2 whitespace-nowrap">{a.event!.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${a.event!.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {a.event!.name || "(unnamed)"}
                  </Link>
                </td>
                <td className="px-4 py-2">{a.role}</td>
                <td className="px-4 py-2 text-right font-semibold">{money(a.flat_wage)}</td>
                <td className="px-4 py-2 text-center">
                  {a.paid_at ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {new Date(a.paid_at).toLocaleDateString()}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {rows.filter((a) => Number(a.flat_wage) > 0).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No wages recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  /* ---------- TAB: Time Off ---------- */
  const timeOffTab = (
    <div className="space-y-5">
      <div className="card max-w-3xl p-5">
        <h2 className="card-title">Add Time Off</h2>
        <form action={addTimeOff.bind(null, id)} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label-xs">Start</label>
            <input type="date" name="start_date" required className="input" />
          </div>
          <div>
            <label className="label-xs">End</label>
            <input type="date" name="end_date" className="input" />
          </div>
          <div>
            <label className="label-xs">Status</label>
            <select name="status" defaultValue="approved" className="input">
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div className="min-w-44 flex-1">
            <label className="label-xs">Reason</label>
            <input name="notes" className="input w-full" placeholder="e.g. Paula visiting" />
          </div>
          <button className="btn-primary">Add</button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Dates</th>
              <th className="px-4 py-2 text-left">Reason</th>
              <th className="px-4 py-2 text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {(timeOff ?? []).map((t) => (
              <tr key={t.id} className="row">
                <td className="px-4 py-2">
                  <span
                    className={`chip ${
                      t.status === "approved"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : t.status === "pending"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-red-500/15 text-red-700 dark:text-red-300"
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {t.start_date}
                  {t.end_date !== t.start_date && ` → ${t.end_date}`}
                </td>
                <td className="px-4 py-2">{t.notes ?? "—"}</td>
                <td className="px-4 py-2 text-right text-xs">
                  {t.status !== "approved" && (
                    <form action={setTimeOffStatus.bind(null, id, t.id, "approved")} className="inline">
                      <button className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Approve</button>
                    </form>
                  )}
                  {t.status !== "pending" && (
                    <form action={setTimeOffStatus.bind(null, id, t.id, "pending")} className="ml-3 inline">
                      <button className="font-semibold text-amber-600 hover:underline dark:text-amber-400">Pending</button>
                    </form>
                  )}
                  {t.status !== "denied" && (
                    <form action={setTimeOffStatus.bind(null, id, t.id, "denied")} className="ml-3 inline">
                      <button className="font-semibold text-red-600 hover:underline dark:text-red-400">Deny</button>
                    </form>
                  )}
                  <form action={deleteTimeOff.bind(null, id, t.id)} className="ml-3 inline">
                    <button className="font-semibold text-zinc-500 hover:underline">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {(timeOff ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No time off on record.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">Approved time off shows on the dashboard calendar automatically.</p>
    </div>
  );

  return (
    <div className="max-w-6xl">
      {/* header */}
      <div className="mb-5">
        <Link href="/employees" className="text-xs font-semibold text-zinc-500 hover:underline">← All Employees</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={emp.first_name} className="size-16 rounded-2xl object-cover" />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-light text-xl font-black text-white">
                {emp.first_name?.[0]}{emp.last_name?.[0]}
              </div>
            )}
            <div>
              <h1 className="page-title">
                {emp.first_name} {emp.last_name}
                {!emp.is_active && <span className="ml-2 text-sm font-normal text-zinc-500">(inactive)</span>}
              </h1>
              <p className="text-sm text-zinc-500">
                {emp.stage_name && <>Stage Name: <span className="text-zinc-700 dark:text-zinc-300">{emp.stage_name}</span> · </>}
                Access: <span className="capitalize text-zinc-700 dark:text-zinc-300">{emp.permission_tier.replace("_", " ")}</span>
              </p>
            </div>
          </div>
          {nextEvent && (
            <Link href={`/events/${nextEvent.event!.id}`} className="card min-w-64 p-3 transition-shadow hover:shadow-lg">
              <div className="label-xs mb-1">Next Event</div>
              <div className="text-sm font-semibold">
                {nextEvent.event!.event_date} · {nextEvent.event!.event_type?.name ?? ""}
              </div>
              <div className="text-xs text-zinc-500">
                {nextEvent.event!.client
                  ? `${nextEvent.event!.client.first_name} ${nextEvent.event!.client.last_name}`
                  : nextEvent.event!.name}
                {nextEvent.event!.venue ? ` · ${nextEvent.event!.venue.name}` : ""}
              </div>
              {nextEvent.event!.status && (
                <div
                  className="mt-1.5 rounded py-0.5 text-center text-xs font-bold"
                  style={{ backgroundColor: nextEvent.event!.status.color, color: nextEvent.event!.status.text_color }}
                >
                  {nextEvent.event!.status.name}
                </div>
              )}
            </Link>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "general", label: "General", content: generalTab },
          { id: "events", label: "Events", badge: rows.length, content: eventsTab },
          { id: "contact", label: "Contact", content: contactTab },
          { id: "wages", label: "Wages", badge: unpaidWages > 0 ? money(unpaidWages) : undefined, content: wagesTab },
          { id: "timeoff", label: "Time Off", badge: (timeOff ?? []).length, content: timeOffTab },
        ]}
      />
    </div>
  );
}
