import {
  assignStaff,
  removeStaff,
  markStaff,
  updateStaffDetails,
  toggleStaffPortal,
} from "@/app/(app)/events/actions";
import { money, type Employee } from "@/lib/types";

type Staff = {
  id: string;
  role: string;
  flat_wage: number;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  notified_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  portal_visible: boolean;
  employee: Employee | null;
};

function StatusButton({
  done,
  doneLabel,
  pendingLabel,
  at,
  action,
}: {
  done: boolean;
  doneLabel: string;
  pendingLabel: string;
  at: string | null;
  action: () => Promise<void>;
}) {
  if (done && at) {
    return (
      <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-300">
        ✓ {doneLabel}
        <span className="font-normal text-emerald-400/70">
          {new Date(at).toLocaleDateString()}{" "}
          {new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
    );
  }
  return (
    <form action={action} className="contents">
      <button className="rounded-lg bg-white/[0.07] px-2 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-brand/60 hover:text-white">
        {pendingLabel}
      </button>
    </form>
  );
}

export default function StaffSection({
  eventId,
  staff,
  employees,
}: {
  eventId: string;
  staff: Staff[];
  employees: Employee[];
}) {
  const input =
    "rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm focus:border-brand-light/70 focus:outline-none";

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {staff.map((s, i) => (
          <div key={s.id} className="card p-5">
            {/* header */}
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-lg font-black text-white">
                  {(s.employee?.first_name?.[0] ?? "?")}{(s.employee?.last_name?.[0] ?? "")}
                </div>
                <div>
                  <div className="font-bold text-white">
                    {s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : "(unknown)"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Position #{i + 1} {i === 0 ? "· Primary Employee" : "· Additional Employee"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Role: <span className="text-zinc-300">{s.role}</span> · Wage:{" "}
                    <span className="text-zinc-300">{money(s.flat_wage)}</span>
                  </div>
                </div>
              </div>
              <form action={removeStaff.bind(null, eventId, s.id)}>
                <button className="text-xs font-semibold text-red-400 hover:underline">Remove</button>
              </form>
            </div>

            {/* status grid */}
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              <StatusButton
                done={!!s.notified_at}
                doneLabel="Notified"
                pendingLabel="✉ Mark As Notified"
                at={s.notified_at}
                action={markStaff.bind(null, eventId, s.id, "notified_at")}
              />
              <StatusButton
                done={!!s.confirmed_at}
                doneLabel="Confirmed"
                pendingLabel="？ Mark As Confirmed"
                at={s.confirmed_at}
                action={markStaff.bind(null, eventId, s.id, "confirmed_at")}
              />
              <StatusButton
                done={!!s.checked_in_at}
                doneLabel="Checked In"
                pendingLabel="✕ Have Not Checked In"
                at={s.checked_in_at}
                action={markStaff.bind(null, eventId, s.id, "checked_in_at")}
              />
              <StatusButton
                done={!!s.checked_out_at}
                doneLabel="Checked Out"
                pendingLabel="✕ Have Not Checked Out"
                at={s.checked_out_at}
                action={markStaff.bind(null, eventId, s.id, "checked_out_at")}
              />
            </div>

            {/* portal visibility */}
            <form action={toggleStaffPortal.bind(null, eventId, s.id, !s.portal_visible)} className="mb-3">
              <button
                className={`w-full rounded-lg px-2 py-1.5 text-xs font-bold ${
                  s.portal_visible
                    ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                    : "bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                Employee Portal: {s.portal_visible ? "Visible" : "Hidden"}
              </button>
            </form>

            {/* details: role / wage / times / notes */}
            <form action={updateStaffDetails.bind(null, eventId, s.id)} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label-xs">Role</label>
                  <input name="role" defaultValue={s.role} className={`${input} w-full`} />
                </div>
                <div>
                  <label className="label-xs">Wage ($)</label>
                  <input type="number" step="0.01" name="flat_wage" defaultValue={s.flat_wage} className={`${input} w-full`} />
                </div>
                <div>
                  <label className="label-xs">Start Time</label>
                  <input type="time" name="start_time" defaultValue={s.start_time ?? ""} className={`${input} w-full`} />
                </div>
                <div>
                  <label className="label-xs">End Time</label>
                  <input type="time" name="end_time" defaultValue={s.end_time ?? ""} className={`${input} w-full`} />
                </div>
              </div>
              <div>
                <label className="label-xs">Notes / Tasks</label>
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={s.notes ?? ""}
                  placeholder="Exactly what this person is doing — feeds the schedule generator later. e.g. Arrive 3:30, set ceremony speakers, run photo booth 7-10."
                  className={`${input} w-full`}
                />
              </div>
              <button className="btn-ghost px-4 py-1.5 text-xs">Save Details</button>
            </form>
          </div>
        ))}

        {staff.length === 0 && (
          <div className="card p-5">
            <p className="text-sm text-zinc-500">No staff assigned yet — assign someone below.</p>
          </div>
        )}
      </div>

      {/* assign */}
      <div className="card max-w-2xl p-5">
        <h2 className="card-title">Assign Staff</h2>
        <form action={assignStaff.bind(null, eventId)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-44 flex-1">
            <label className="label-xs">Employee</label>
            <select name="employee_id" required className={`${input} w-full`}>
              <option value="">Select…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs">Role</label>
            <input name="role" defaultValue="DJ" list="staff-roles" className={`${input} w-36`} />
            <datalist id="staff-roles">
              {["DJ", "MC", "Photo Booth Attendant", "Setup / Takedown", "Production Assistant", "Lighting Tech"].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label-xs">Wage ($)</label>
            <input type="number" step="0.01" name="flat_wage" defaultValue={0} className={`${input} w-24`} />
          </div>
          <button className="btn-primary">Assign</button>
        </form>
      </div>
    </div>
  );
}
