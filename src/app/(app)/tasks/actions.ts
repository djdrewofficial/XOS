"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe, requireModule } from "@/lib/auth";
import {
  evaluateTaskRules,
  isConditionField,
  TRIGGER_ANCHORS,
  ASSIGNEE_TYPES,
  DEPARTMENTS,
  type Condition,
  type ConditionOp,
} from "@/lib/taskRules";

const ANCHOR_SET = new Set<string>(TRIGGER_ANCHORS.map((a) => a.value));
const ASSIGNEE_SET = new Set<string>(ASSIGNEE_TYPES.map((a) => a.value));
const DEPT_SET = new Set<string>(DEPARTMENTS);
const OP_SET = new Set<ConditionOp>(["is", "is_not", "is_true", "is_false"]);
const PRIORITY_SET = new Set(["low", "normal", "high"]);
const nowIso = () => new Date().toISOString();

function clean(v: FormDataEntryValue | null | undefined): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function intOr(v: unknown, d = 0): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

/** Every write requires Edit on the Tasks module (Settings → Permissions). */
async function editContext() {
  const supabase = await createClient();
  await requireModule("tasks", "edit", { mode: "throw", supabase });
  const me = await getMe(supabase);
  return { supabase, employeeId: me?.employeeId ?? null };
}

async function deptOf(supabase: Awaited<ReturnType<typeof createClient>>, employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null;
  const { data } = await supabase.from("employees").select("staff_category").eq("id", employeeId).maybeSingle();
  return (data?.staff_category as string) ?? null;
}

// ---- Task instances -------------------------------------------------------

export async function createTask(formData: FormData) {
  const { supabase, employeeId } = await editContext();
  const title = clean(formData.get("title"));
  if (!title) return;
  const assignee = clean(formData.get("assigned_employee_id"));
  let department = clean(formData.get("department"));
  if (assignee && !department) department = await deptOf(supabase, assignee);
  await supabase.from("tasks").insert({
    title,
    body: clean(formData.get("body")),
    assigned_employee_id: assignee,
    department,
    due_date: clean(formData.get("due_date")),
    priority: PRIORITY_SET.has(clean(formData.get("priority")) ?? "") ? clean(formData.get("priority")) : "normal",
    event_id: clean(formData.get("event_id")),
    created_by: employeeId,
  });
  revalidatePath("/tasks");
}

export async function setTaskStatus(id: string, status: string) {
  if (!["not_started", "in_progress", "done", "dismissed"].includes(status)) return;
  const { supabase, employeeId } = await editContext();
  const patch: Record<string, unknown> = { status, updated_at: nowIso() };
  if (status === "done") {
    patch.completed_at = nowIso();
    patch.completed_by = employeeId;
  } else {
    patch.completed_at = null;
    patch.completed_by = null;
  }
  await supabase.from("tasks").update(patch).eq("id", id);
  revalidatePath("/tasks");
}

export async function assignTask(id: string, employeeId: string | null) {
  const { supabase } = await editContext();
  const department = await deptOf(supabase, employeeId);
  await supabase
    .from("tasks")
    .update({ assigned_employee_id: employeeId, department, updated_at: nowIso() })
    .eq("id", id);
  revalidatePath("/tasks");
}

export async function deleteTask(id: string) {
  const { supabase } = await editContext();
  await supabase.from("tasks").delete().eq("id", id);
  revalidatePath("/tasks");
}

export type TaskComment = { id: string; body: string; created_at: string; author: string };

export async function getComments(taskId: string): Promise<TaskComment[]> {
  const supabase = await createClient();
  await requireModule("tasks", "view", { mode: "throw", supabase });
  const { data } = await supabase
    .from("task_comments")
    .select("id,body,created_at,author:employees(first_name,last_name,stage_name)")
    .eq("task_id", taskId)
    .order("created_at");
  return (data ?? []).map((c) => {
    const a = c.author as { first_name?: string; last_name?: string; stage_name?: string } | null;
    return {
      id: c.id as string,
      body: c.body as string,
      created_at: c.created_at as string,
      author: a?.stage_name || [a?.first_name, a?.last_name].filter(Boolean).join(" ") || "Staff",
    };
  });
}

export async function addComment(taskId: string, body: string) {
  const { supabase, employeeId } = await editContext();
  const b = body.trim();
  if (!b) return;
  await supabase.from("task_comments").insert({ task_id: taskId, body: b, author_employee_id: employeeId });
  revalidatePath("/tasks");
}

/** Run the rule engine on demand (the "Run rules now" button). */
export async function runRulesNow() {
  const supabase = await createClient();
  await requireModule("tasks", "edit", { mode: "throw", supabase });
  const admin = createAdminClient();
  const res = await evaluateTaskRules(admin);
  revalidatePath("/tasks");
  return res;
}

// ---- Rules ----------------------------------------------------------------

export type RuleInput = {
  id?: string | null;
  name?: string;
  description?: string | null;
  is_active?: boolean;
  trigger_anchor?: string;
  offset_days?: number;
  horizon_days?: number | null;
  conditions?: Condition[];
  condition_logic?: string;
  task_title?: string;
  task_body?: string | null;
  task_priority?: string;
  assignee_type?: string;
  assignee_employee_id?: string | null;
  assignee_department?: string | null;
  due_offset_days?: number;
  due_anchor?: string | null;
  source?: string;
  ai_prompt?: string | null;
};

function sanitizeConditions(input: unknown): Condition[] {
  if (!Array.isArray(input)) return [];
  const out: Condition[] = [];
  for (const c of input) {
    if (!c || typeof c !== "object") continue;
    const field = String((c as Condition).field ?? "");
    const op = (c as Condition).op;
    if (!isConditionField(field) || !OP_SET.has(op)) continue;
    out.push({ field, op, value: (c as Condition).value ?? null });
  }
  return out;
}

export async function saveRule(input: RuleInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { supabase, employeeId } = await editContext();
  const anchor = ANCHOR_SET.has(input.trigger_anchor ?? "") ? input.trigger_anchor! : "event_date";
  const assigneeType = ASSIGNEE_SET.has(input.assignee_type ?? "") ? input.assignee_type! : "unassigned";
  const row = {
    name: (input.name ?? "").trim() || "Untitled rule",
    description: input.description?.toString().trim() || null,
    is_active: input.is_active ?? true,
    trigger_anchor: anchor,
    offset_days: intOr(input.offset_days, 0),
    horizon_days: anchor === "none" ? (input.horizon_days == null ? 60 : intOr(input.horizon_days, 60)) : null,
    conditions: sanitizeConditions(input.conditions),
    condition_logic: input.condition_logic === "any" ? "any" : "all",
    task_title: (input.task_title ?? "").trim() || "{{event_label}}",
    task_body: input.task_body?.toString().trim() || null,
    task_priority: PRIORITY_SET.has(input.task_priority ?? "") ? input.task_priority! : "normal",
    assignee_type: assigneeType,
    assignee_employee_id: assigneeType === "staff" ? input.assignee_employee_id || null : null,
    assignee_department:
      assigneeType === "department" && DEPT_SET.has(input.assignee_department ?? "") ? input.assignee_department! : null,
    due_offset_days: intOr(input.due_offset_days, 0),
    due_anchor: ANCHOR_SET.has(input.due_anchor ?? "") && input.due_anchor !== "none" ? input.due_anchor! : null,
    source: input.source === "ai" ? "ai" : "manual",
    ai_prompt: input.ai_prompt?.toString().trim() || null,
    updated_at: nowIso(),
  };

  if (input.id) {
    const { error } = await supabase.from("task_rules").update(row).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/tasks/settings");
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("task_rules")
    .insert({ ...row, created_by: employeeId })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tasks/settings");
  return { ok: true, id: data?.id as string };
}

export async function toggleRule(id: string, isActive: boolean) {
  const { supabase } = await editContext();
  await supabase.from("task_rules").update({ is_active: isActive, updated_at: nowIso() }).eq("id", id);
  revalidatePath("/tasks/settings");
}

export async function deleteRule(id: string) {
  const { supabase } = await editContext();
  await supabase.from("task_rules").delete().eq("id", id);
  revalidatePath("/tasks/settings");
}
