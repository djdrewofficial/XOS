import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/types";
import { createEmployee, toggleEmployee } from "./actions";
import LiveFilter from "@/components/LiveFilter";
import SaveButton from "@/components/SaveButton";

export const dynamic = "force-dynamic";

const TIERS = ["master_admin", "admin", "salesperson", "employee"] as const;
const STAFF_CATEGORIES = ["Administrators", "Salespeople", "Production", "Subcontractors", "Live Musicians"] as const;

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("first_name");

  const active = (employees ?? []).filter((e) => e.is_active);
  const inactive = (employees ?? []).filter((e) => !e.is_active);

  const groups: { label: string; members: typeof active }[] = STAFF_CATEGORIES.map((cat) => ({
    label: cat,
    members: active.filter((e) => (e.staff_category ?? "Production") === cat),
  }));
  groups.push({ label: "Inactive", members: inactive });

  function EmployeeTable({ members }: { members: NonNullable<typeof employees> }) {
    return (
      <div className="card overflow-hidden rounded-t-none">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Stage Name</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Access</th>
              <th className="px-4 py-2 text-right">Hourly Rate</th>
              <th className="px-4 py-2 text-center">Manage</th>
            </tr>
          </thead>
          <tbody>
            {members.map((e) => (
              <tr key={e.id} data-searchable className={`row ${!e.is_active ? "opacity-60" : ""}`}>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/employees/${e.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {e.first_name} {e.last_name}
                  </Link>
                </td>
                <td className="px-4 py-2">{e.stage_name ?? "—"}</td>
                <td className="px-4 py-2">{e.email ?? "—"}</td>
                <td className="px-4 py-2 capitalize">{e.permission_tier.replace("_", " ")}</td>
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
            {members.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-xs text-zinc-500">Nobody here yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="max-w-[1700px]" id="employees-root">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="page-title">Employees</h1>
        <span className="rounded-full bg-black/[0.06] px-2.5 py-0.5 text-sm font-semibold text-zinc-500 dark:bg-white/[0.08] dark:text-zinc-400">
          {(employees ?? []).length}
        </span>
      </div>

      <div className="mb-5">
        <LiveFilter targetSelector="#employees-root" placeholder="Search employees by name, stage name, email…" />
      </div>

      {groups.map((g) => (
        <div key={g.label} className="mb-6" data-search-group>
          <h2
            className={`mb-0 rounded-t-xl px-4 py-2 text-sm font-bold uppercase tracking-wide ${
              g.label === "Inactive"
                ? "bg-black/[0.07] text-zinc-600 dark:bg-white/10 dark:text-zinc-400"
                : "bg-gradient-to-r from-brand to-brand-light text-white"
            }`}
          >
            {g.label}
            <span className="ml-2 text-xs font-semibold opacity-70">{g.members.length}</span>
          </h2>
          <EmployeeTable members={g.members} />
        </div>
      ))}

      <h2 className="card-title mt-8">Add Employee</h2>
      <form action={createEmployee} className="card grid gap-4 p-5 md:grid-cols-3">
        <div>
          <label className="label-xs">First Name</label>
          <input name="first_name" required className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Last Name</label>
          <input name="last_name" className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Staff Category</label>
          <select name="staff_category" defaultValue="Production" className="input w-full">
            {STAFF_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-xs">Email</label>
          <input type="email" name="email" className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Phone</label>
          <input name="phone" className="input w-full" />
        </div>
        <div>
          <label className="label-xs">Access Level</label>
          <select name="permission_tier" defaultValue="employee" className="input w-full">
            {TIERS.map((t) => (
              <option key={t} value={t}>{t.replace("_", " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-xs">Hourly Rate ($)</label>
          <input type="number" step="0.01" name="hourly_rate" className="input w-full" />
        </div>
        <div className="md:col-span-3">
          <SaveButton savedLabel="Added">Add Employee</SaveButton>
        </div>
      </form>
    </div>
  );
}
