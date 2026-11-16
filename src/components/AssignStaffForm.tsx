"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignStaff } from "@/app/(app)/events/actions";
import type { Employee } from "@/lib/types";

const ROLES = ["DJ", "MC", "Photo Booth Attendant", "Setup / Takedown", "Production Assistant", "Lighting Tech", "Live Musician"];

export default function AssignStaffForm({
  eventId,
  employees,
  inputClass,
}: {
  eventId: string;
  employees: Employee[];
  inputClass: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [payType, setPayType] = useState<"flat" | "hourly">("flat");

  const selected = employees.find((e) => e.id === employeeId) ?? null;

  function onEmployeeChange(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    // Default hourly when the employee has an hourly rate (and no forced flat).
    if (emp?.hourly_rate != null && Number(emp.hourly_rate) > 0) setPayType("hourly");
    else setPayType("flat");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!fd.get("employee_id")) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      try {
        await assignStaff(eventId, fd);
        form.reset();
        setEmployeeId("");
        setPayType("flat");
        setMsg("Added ✓");
        router.refresh();
        setTimeout(() => setMsg(null), 1800);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't assign.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-44 flex-1">
        <label className="label-xs">Employee</label>
        <select
          name="employee_id"
          required
          value={employeeId}
          onChange={(e) => onEmployeeChange(e.target.value)}
          className={`${inputClass} w-full`}
        >
          <option value="">Select…</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.first_name} {emp.last_name}
              {emp.hourly_rate != null ? ` ($${Number(emp.hourly_rate)}/hr)` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-xs">Role</label>
        <select name="role" defaultValue="DJ" className={`${inputClass} w-44`}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-xs">Pay type</label>
        <select
          name="pay_type"
          value={payType}
          onChange={(e) => setPayType(e.target.value as "flat" | "hourly")}
          className={`${inputClass} w-28`}
        >
          <option value="flat">Flat</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>
      {payType === "flat" ? (
        <div>
          <label className="label-xs">Wage ($)</label>
          <input type="number" step="0.01" name="flat_wage" defaultValue={0} className={`${inputClass} w-24`} />
        </div>
      ) : (
        <div>
          <label className="label-xs">Hourly override ($)</label>
          <input
            type="number"
            step="0.01"
            name="hourly_rate_override"
            placeholder={selected?.hourly_rate != null ? String(selected.hourly_rate) : ""}
            className={`${inputClass} w-28`}
          />
        </div>
      )}
      <button disabled={pending} className="btn-primary px-5 py-2 disabled:opacity-50">
        {pending ? "Assigning…" : "Assign"}
      </button>
      {msg && <span className="pb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{msg}</span>}
      {err && <span className="pb-2 text-xs text-red-500">{err}</span>}
    </form>
  );
}
