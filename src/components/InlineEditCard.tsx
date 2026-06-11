"use client";

import { useState, useTransition, type ReactNode } from "react";
import SaveButton from "@/components/SaveButton";

export type InlineField = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "time" | "select" | "url";
  value: string | number | null;
  options?: { value: string; label: string }[];
  placeholder?: string;
  step?: string;
  span2?: boolean;
};

export default function InlineEditCard({
  fields,
  save,
  children,
  editLabel = "Edit",
}: {
  fields: InlineField[];
  save: (formData: FormData) => Promise<void>;
  children: ReactNode;
  editLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();

  if (!editing) {
    return (
      <div>
        {children}
        <button onClick={() => setEditing(true)} className="btn-ghost mt-4 px-4 py-1.5 text-xs">
          {editLabel}
        </button>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await save(fd);
          setEditing(false);
        })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.name} className={f.span2 ? "col-span-2" : ""}>
            <label className="label-xs">{f.label}</label>
            {f.type === "select" ? (
              <select name={f.name} defaultValue={f.value?.toString() ?? ""} className="input w-full">
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "url" ? "text" : f.type}
                name={f.name}
                step={f.step}
                defaultValue={f.value?.toString() ?? ""}
                placeholder={f.placeholder}
                className="input w-full"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <SaveButton className="btn-primary px-5 py-2 text-xs">Save</SaveButton>
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-4 py-2 text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
