"use client";

import { useState } from "react";
import SaveButton from "@/components/SaveButton";
import type { Access } from "@/lib/permissions";

type Subject = { id: string; name: string; role: string; roleLabel: string };

const ACCESS_LABEL: Record<Access, string> = { none: "No access", view: "View", edit: "Edit" };

export default function UserPermissionEditor({
  employees,
  modules,
  landingPages,
  roleDefaults,
  roleLanding,
  overrides,
  action,
}: {
  employees: Subject[];
  modules: { key: string; label: string }[];
  landingPages: ReadonlyArray<readonly [string, string]>;
  roleDefaults: Record<string, Record<string, Access>>;
  roleLanding: Record<string, string>;
  overrides: Record<string, { perms: Record<string, Access>; landing: string | null }>;
  action: (formData: FormData) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(employees[0]?.id ?? "");
  const subject = employees.find((e) => e.id === selectedId);

  if (employees.length === 0) {
    return (
      <p className="card p-6 text-center text-sm text-zinc-500">
        No active employees to configure.
      </p>
    );
  }

  const ov = overrides[selectedId] ?? { perms: {}, landing: null };
  const defaults = subject ? roleDefaults[subject.role] ?? {} : {};
  const landingDefaultLabel =
    landingPages.find(([v]) => v === (subject ? roleLanding[subject.role] : "/"))?.[1] ??
    "Dashboard";

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Employee</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="input min-w-56"
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.roleLabel}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          &quot;Inherit&quot; uses the role default. Set a level to override it for this person only.
        </p>
      </div>

      {/* key forces a fresh form (resetting defaultValues) when switching people */}
      <form key={selectedId} action={action} className="space-y-5">
        <input type="hidden" name="employee_id" value={selectedId} />

        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white">
            Screen Access — {subject?.name}
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            {modules.map((m) => {
              const inheritLabel = ACCESS_LABEL[defaults[m.key] ?? "none"];
              return (
                <div key={m.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{m.label}</span>
                  <select
                    name={`perm_${m.key}`}
                    defaultValue={ov.perms[m.key] ?? ""}
                    className="input w-44"
                  >
                    <option value="">Inherit ({inheritLabel})</option>
                    <option value="none">No access</option>
                    <option value="view">View (read-only)</option>
                    <option value="edit">Edit (read &amp; write)</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white">
            Landing Screen After Login
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">This employee lands on</span>
            <select name="landing_page" defaultValue={ov.landing ?? ""} className="input w-56">
              <option value="">Use role default ({landingDefaultLabel})</option>
              {landingPages.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <SaveButton>Save Overrides</SaveButton>
        </div>
      </form>
    </div>
  );
}
