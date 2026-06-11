import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { createEmployee, toggleEmployee } from "./actions";

export const dynamic = "force-dynamic";

const TIERS = ["master_admin", "admin", "salesperson", "employee"] as const;

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("is_active", { ascending: false })
    .order("first_name");

  const input =
    "input w-full";
  const label = "label-xs";

  return (
    <div className="max-w-4xl">
      <h1 className="mb-5 text-2xl font-bold">Employees</h1>

      <div className="mb-6 card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2 text-right">Hourly Rate</th>
              <th className="px-4 py-2 text-center">Active</th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => (
              <tr key={e.id} className={`row ${!e.is_active ? "opacity-40" : ""}`}>
                <td className="px-4 py-2 font-medium">{e.first_name} {e.last_name}</td>
                <td className="px-4 py-2">{e.email ?? "—"}</td>
                <td className="px-4 py-2">{e.permission_tier.replace("_", " ")}</td>
                <td className="px-4 py-2 text-right">{e.hourly_rate ? money(e.hourly_rate) : "—"}</td>
                <td className="px-4 py-2 text-center">
                  <form action={toggleEmployee.bind(null, e.id, !e.is_active)}>
                    <button className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">
                      {e.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {(employees ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-400">No employees yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="card-title">Add Employee</h2>
      <form action={createEmployee} className="grid gap-4 card p-5 md:grid-cols-3">
        <div>
          <label className={label}>First Name</label>
          <input name="first_name" required className={input} />
        </div>
        <div>
          <label className={label}>Last Name</label>
          <input name="last_name" className={input} />
        </div>
        <div>
          <label className={label}>Email</label>
          <input type="email" name="email" className={input} />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input name="phone" className={input} />
        </div>
        <div>
          <label className={label}>Permission Tier</label>
          <select name="permission_tier" defaultValue="employee" className={input}>
            {TIERS.map((t) => (
              <option key={t} value={t}>{t.replace("_", " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Hourly Rate ($)</label>
          <input type="number" step="0.01" name="hourly_rate" className={input} />
        </div>
        <div className="md:col-span-3">
          <button className="btn-primary">
            Add Employee
          </button>
        </div>
      </form>
    </div>
  );
}
