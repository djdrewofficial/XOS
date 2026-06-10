import { assignStaff, removeStaff, markStaff } from "@/app/(app)/events/actions";
import { money, type Employee } from "@/lib/types";

type Staff = {
  id: string;
  role: string;
  flat_wage: number;
  notified_at: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  employee: Employee | null;
};

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
    "input";

  return (
    <div className="card p-5">
      <h2 className="card-title">Staff</h2>

      <div className="mb-4 space-y-3">
        {staff.map((s) => (
          <div key={s.id} className="rounded-md border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold">
                  {s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : "(unknown)"}
                </span>
                <span className="ml-2 text-sm text-zinc-500">{s.role}</span>
                {s.flat_wage > 0 && (
                  <span className="ml-2 text-sm text-zinc-500">· {money(s.flat_wage)}</span>
                )}
              </div>
              <form action={removeStaff.bind(null, eventId, s.id)}>
                <button className="text-xs font-semibold text-red-400 hover:underline">Remove</button>
              </form>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {(
                [
                  ["notified_at", "Notified", s.notified_at],
                  ["confirmed_at", "Confirmed", s.confirmed_at],
                  ["checked_in_at", "Checked In", s.checked_in_at],
                  ["checked_out_at", "Checked Out", s.checked_out_at],
                ] as const
              ).map(([field, label, value]) =>
                value ? (
                  <span key={field} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-300">
                    ✓ {label} {new Date(value).toLocaleDateString()}
                  </span>
                ) : (
                  <form key={field} action={markStaff.bind(null, eventId, s.id, field)}>
                    <button className="rounded bg-white/10 px-2 py-1 font-semibold text-zinc-300 hover:bg-white/20">
                      Mark {label}
                    </button>
                  </form>
                )
              )}
            </div>
          </div>
        ))}
        {staff.length === 0 && <p className="text-sm text-zinc-400">No staff assigned yet.</p>}
      </div>

      <form action={assignStaff.bind(null, eventId)} className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
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
          <input name="role" defaultValue="DJ" className={`${input} w-28`} />
        </div>
        <div>
          <label className="label-xs">Wage ($)</label>
          <input type="number" step="0.01" name="flat_wage" defaultValue={0} className={`${input} w-24`} />
        </div>
        <button className="btn-primary px-4 py-2">
          Assign
        </button>
      </form>
    </div>
  );
}
