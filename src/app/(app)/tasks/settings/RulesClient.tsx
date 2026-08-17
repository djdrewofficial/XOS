"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONDITION_FIELDS,
  TRIGGER_ANCHORS,
  ASSIGNEE_TYPES,
  type Condition,
  type ConditionOp,
} from "@/lib/taskRules";
import { saveRule, toggleRule, deleteRule, type RuleInput } from "../actions";

export type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_anchor: string;
  offset_days: number;
  horizon_days: number | null;
  conditions: Condition[] | null;
  condition_logic: string;
  task_title: string;
  task_body: string | null;
  task_priority: string;
  assignee_type: string;
  assignee_employee_id: string | null;
  assignee_department: string | null;
  due_offset_days: number;
  due_anchor: string | null;
  source: string;
  ai_prompt: string | null;
  last_evaluated_at: string | null;
};

export type Options = {
  event_types: string[];
  journey_types: string[];
  statuses: string[];
  venues: string[];
  departments: string[];
  staff: { id: string; name: string }[];
};

type Draft = Required<Omit<RuleInput, "id">> & { id?: string | null };

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    description: "",
    is_active: true,
    trigger_anchor: "event_date",
    offset_days: -4,
    horizon_days: 60,
    conditions: [],
    condition_logic: "all",
    task_title: "",
    task_body: "",
    task_priority: "normal",
    assignee_type: "unassigned",
    assignee_employee_id: null,
    assignee_department: null,
    due_offset_days: 0,
    due_anchor: null,
    source: "manual",
    ai_prompt: "",
  };
}
function fromRule(r: RuleRow): Draft {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    is_active: r.is_active,
    trigger_anchor: r.trigger_anchor,
    offset_days: r.offset_days,
    horizon_days: r.horizon_days ?? 60,
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
    condition_logic: r.condition_logic,
    task_title: r.task_title,
    task_body: r.task_body ?? "",
    task_priority: r.task_priority,
    assignee_type: r.assignee_type,
    assignee_employee_id: r.assignee_employee_id,
    assignee_department: r.assignee_department,
    due_offset_days: r.due_offset_days,
    due_anchor: r.due_anchor,
    source: r.source,
    ai_prompt: r.ai_prompt ?? "",
  };
}

const fieldMeta = (f: string) => CONDITION_FIELDS.find((c) => c.field === f);

function summarize(r: RuleRow): string {
  const anchorLabel = TRIGGER_ANCHORS.find((a) => a.value === r.trigger_anchor)?.label ?? r.trigger_anchor;
  let when: string;
  if (r.trigger_anchor === "none") when = `Any upcoming event (next ${r.horizon_days ?? 60} days)`;
  else if (r.offset_days === 0) when = `On the ${anchorLabel.toLowerCase()}`;
  else when = `${Math.abs(r.offset_days)} day${Math.abs(r.offset_days) === 1 ? "" : "s"} ${r.offset_days < 0 ? "before" : "after"} ${anchorLabel.toLowerCase()}`;
  const conds = (r.conditions ?? []).length;
  return conds > 0 ? `${when} · ${conds} condition${conds === 1 ? "" : "s"}` : when;
}

export default function RulesClient({ rules, options }: { rules: RuleRow[]; options: Options }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setDraft(emptyDraft())} className="btn-primary px-4 py-1.5 text-sm">
          + New rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">
          No rules yet. Create one to start auto-generating tasks — try &ldquo;4 days before the event, remind the DJ to review the timeline.&rdquo;
        </div>
      ) : (
        <div className="card divide-y divide-zinc-100 dark:divide-white/5">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={async () => { await toggleRule(r.id, !r.is_active); router.refresh(); }}
                title={r.is_active ? "Active — click to pause" : "Paused — click to activate"}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${r.is_active ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.is_active ? "left-4" : "left-0.5"}`} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  {r.source === "ai" && <span className="rounded bg-brand/10 px-1.5 py-px text-[10px] text-brand">AI</span>}
                  {!r.is_active && <span className="text-[10px] text-zinc-400">paused</span>}
                </div>
                <div className="truncate text-xs text-zinc-500">{summarize(r)}</div>
              </div>
              <button onClick={() => setDraft(fromRule(r))} className="text-xs text-brand hover:underline">
                Edit
              </button>
              <button
                onClick={async () => { if (confirm(`Delete rule "${r.name}"? Tasks it already created stay.`)) { await deleteRule(r.id); router.refresh(); } }}
                className="text-xs text-red-500 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <RuleBuilder
          draft={draft}
          setDraft={setDraft}
          options={options}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function RuleBuilder({
  draft,
  setDraft,
  options,
  onClose,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  options: Options;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"ai" | "manual">(draft.id ? "manual" : "ai");
  const [aiPrompt, setAiPrompt] = useState(draft.ai_prompt || "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  async function generate() {
    setAiBusy(true);
    setAiError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/tasks/ai-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: aiPrompt }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAiError(json.error || "Generation failed.");
        return;
      }
      const d = json.draft ?? {};
      setDraft({
        ...draft,
        name: d.name || draft.name || aiPrompt.slice(0, 60),
        description: d.description ?? "",
        trigger_anchor: d.trigger_anchor ?? "event_date",
        offset_days: typeof d.offset_days === "number" ? d.offset_days : 0,
        horizon_days: d.horizon_days ?? 60,
        conditions: Array.isArray(d.conditions) ? d.conditions.filter((c: Condition) => fieldMeta(c.field)) : [],
        condition_logic: d.condition_logic === "any" ? "any" : "all",
        task_title: d.task_title ?? "",
        task_body: d.task_body ?? "",
        task_priority: ["low", "normal", "high"].includes(d.task_priority) ? d.task_priority : "normal",
        assignee_type: d.assignee_type ?? "unassigned",
        assignee_employee_id: d.assignee_employee_id ?? null,
        assignee_department: d.assignee_department ?? null,
        due_offset_days: typeof d.due_offset_days === "number" ? d.due_offset_days : 0,
        due_anchor: d.due_anchor ?? null,
        source: "ai",
        ai_prompt: aiPrompt,
      });
      if (d.warning) setWarning(d.warning);
      setMode("manual");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    const res = await saveRule(draft as RuleInput);
    setSaving(false);
    if (res.ok) onSaved();
    else setAiError(res.error || "Save failed.");
  }

  const isNone = draft.trigger_anchor === "none";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10" onClick={onClose}>
      <div className="card w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="card-title">{draft.id ? "Edit rule" : "New rule"}</h2>
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-white/10">
            <button onClick={() => setMode("ai")} className={`rounded-md px-3 py-1 text-xs font-medium ${mode === "ai" ? "bg-brand text-white" : "text-zinc-500"}`}>
              ✨ AI
            </button>
            <button onClick={() => setMode("manual")} className={`rounded-md px-3 py-1 text-xs font-medium ${mode === "manual" ? "bg-brand text-white" : "text-zinc-500"}`}>
              Manual
            </button>
          </div>
        </div>

        {mode === "ai" ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Describe the automation in plain English. Example: <em>&ldquo;4 days before every event, create a task for the Production team to send the timeline to the DJs.&rdquo;</em>
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              className="input w-full"
              placeholder="When a wedding is booked but no DJ is assigned yet, remind Drew to assign one…"
            />
            {aiError && <div className="text-xs text-red-500">{aiError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">Cancel</button>
              <button onClick={generate} disabled={aiBusy || !aiPrompt.trim()} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
                {aiBusy ? "Generating…" : "Generate rule →"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {warning && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ⚠️ {warning}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-xs">Rule name</label>
                <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="input w-full" placeholder="Send timeline to DJs" />
              </div>
            </div>

            {/* WHEN */}
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">When</div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="label-xs">Timing</label>
                  <select value={draft.trigger_anchor} onChange={(e) => set({ trigger_anchor: e.target.value })} className="input">
                    {TRIGGER_ANCHORS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
                {isNone ? (
                  <div>
                    <label className="label-xs">Look ahead (days)</label>
                    <input type="number" value={draft.horizon_days ?? 60} onChange={(e) => set({ horizon_days: parseInt(e.target.value) || 0 })} className="input w-28" />
                  </div>
                ) : (
                  <div>
                    <label className="label-xs">Offset (days — negative = before)</label>
                    <input type="number" value={draft.offset_days} onChange={(e) => set({ offset_days: parseInt(e.target.value) || 0 })} className="input w-40" />
                  </div>
                )}
              </div>
            </div>

            {/* CONDITIONS */}
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Only if</span>
                {draft.conditions.length > 1 && (
                  <select value={draft.condition_logic} onChange={(e) => set({ condition_logic: e.target.value })} className="input h-6 text-xs">
                    <option value="all">match ALL</option>
                    <option value="any">match ANY</option>
                  </select>
                )}
              </div>
              <div className="space-y-2">
                {draft.conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    cond={c}
                    options={options}
                    onChange={(nc) => set({ conditions: draft.conditions.map((x, j) => (j === i ? nc : x)) })}
                    onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                  />
                ))}
                <button
                  onClick={() => set({ conditions: [...draft.conditions, { field: "event_type", op: "is", value: options.event_types[0] ?? "" }] })}
                  className="text-xs text-brand hover:underline"
                >
                  + Add condition
                </button>
                {draft.conditions.length === 0 && <p className="text-xs text-zinc-400">No conditions — applies to every event that matches the timing.</p>}
              </div>
            </div>

            {/* TASK */}
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Create this task</div>
              <div className="space-y-2">
                <div>
                  <label className="label-xs">Title (tokens: {"{{event_label}}"}, {"{{client_name}}"}, {"{{event_date}}"}, {"{{dj_name}}"})</label>
                  <input value={draft.task_title} onChange={(e) => set({ task_title: e.target.value })} className="input w-full" placeholder="Request Timeline for {{event_label}}" />
                </div>
                <div>
                  <label className="label-xs">Details (optional)</label>
                  <textarea value={draft.task_body ?? ""} onChange={(e) => set({ task_body: e.target.value })} rows={2} className="input w-full" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="label-xs">Priority</label>
                    <select value={draft.task_priority} onChange={(e) => set({ task_priority: e.target.value })} className="input w-full">
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-xs">Assign to</label>
                    <select value={draft.assignee_type} onChange={(e) => set({ assignee_type: e.target.value })} className="input w-full">
                      {ASSIGNEE_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  {draft.assignee_type === "staff" && (
                    <div>
                      <label className="label-xs">Staff member</label>
                      <select value={draft.assignee_employee_id ?? ""} onChange={(e) => set({ assignee_employee_id: e.target.value || null })} className="input w-full">
                        <option value="">Choose…</option>
                        {options.staff.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {draft.assignee_type === "department" && (
                    <div>
                      <label className="label-xs">Department</label>
                      <select value={draft.assignee_department ?? ""} onChange={(e) => set({ assignee_department: e.target.value || null })} className="input w-full">
                        <option value="">Choose…</option>
                        {options.departments.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="label-xs">Due (days from timing)</label>
                    <input type="number" value={draft.due_offset_days} onChange={(e) => set({ due_offset_days: parseInt(e.target.value) || 0 })} className="input w-full" />
                  </div>
                </div>
              </div>
            </div>

            {aiError && <div className="text-xs text-red-500">{aiError}</div>}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" checked={draft.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
                Active
              </label>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !draft.task_title.trim()} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
                  {saving ? "Saving…" : "Save rule"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConditionRow({
  cond,
  options,
  onChange,
  onRemove,
}: {
  cond: Condition;
  options: Options;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const meta = fieldMeta(cond.field);
  const kind = meta?.kind ?? "boolean";
  const enumValues =
    kind === "enum"
      ? meta?.options ?? []
      : meta?.source
        ? options[meta.source]
        : [];

  function changeField(field: string) {
    const m = fieldMeta(field);
    if (m?.kind === "boolean") onChange({ field, op: "is_true" });
    else {
      const vals = m?.kind === "enum" ? m.options ?? [] : m?.source ? options[m.source] : [];
      onChange({ field, op: "is", value: vals[0] ?? "" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={cond.field} onChange={(e) => changeField(e.target.value)} className="input h-8 text-xs">
        {CONDITION_FIELDS.map((f) => (
          <option key={f.field} value={f.field}>{f.label}</option>
        ))}
      </select>

      {kind === "boolean" ? (
        <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as ConditionOp })} className="input h-8 text-xs">
          <option value="is_true">is yes</option>
          <option value="is_false">is no</option>
        </select>
      ) : (
        <>
          <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as ConditionOp })} className="input h-8 text-xs">
            <option value="is">is</option>
            <option value="is_not">is not</option>
          </select>
          <select value={cond.value ?? ""} onChange={(e) => onChange({ ...cond, value: e.target.value })} className="input h-8 text-xs">
            {(enumValues ?? []).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </>
      )}

      {meta?.help && <span className="text-[10px] text-amber-500" title={meta.help}>ⓘ</span>}
      <button onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-500">✕</button>
    </div>
  );
}
