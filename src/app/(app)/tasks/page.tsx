import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule, getMe } from "@/lib/auth";
import { DEPARTMENTS } from "@/lib/taskRules";
import TasksView, { type TaskCard, type StaffOption } from "./TasksView";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const supabase = await createClient();
  await requireModule("tasks", "view", { supabase });
  const me = await getMe(supabase);
  const canEdit = me?.can["tasks"] === "edit";

  const [{ data: rawTasks }, { data: rawStaff }, { data: counts }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        `id,title,body,status,priority,department,due_date,assigned_employee_id,event_id,rule_id,created_at,completed_at,
         assignee:employees!tasks_assigned_employee_id_fkey(id,first_name,last_name,stage_name),
         event:events!tasks_event_id_fkey(id,event_number,name,event_date)`,
      )
      .neq("status", "dismissed")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("employees")
      .select("id,first_name,last_name,stage_name,staff_category")
      .eq("is_active", true)
      .order("first_name"),
    supabase.from("task_comments").select("task_id"),
  ]);

  const commentCount = new Map<string, number>();
  for (const c of counts ?? []) {
    const k = c.task_id as string;
    commentCount.set(k, (commentCount.get(k) ?? 0) + 1);
  }

  const staff: StaffOption[] = (rawStaff ?? []).map((s) => ({
    id: s.id as string,
    name: (s.stage_name as string) || [s.first_name, s.last_name].filter(Boolean).join(" "),
    department: (s.staff_category as string) ?? null,
  }));

  const tasks: TaskCard[] = (rawTasks ?? []).map((t) => {
    const a = t.assignee as { id?: string; first_name?: string; last_name?: string; stage_name?: string } | null;
    const ev = t.event as { id?: string; event_number?: number; name?: string; event_date?: string } | null;
    return {
      id: t.id as string,
      title: t.title as string,
      body: (t.body as string) ?? null,
      status: t.status as TaskCard["status"],
      priority: t.priority as TaskCard["priority"],
      department: (t.department as string) ?? null,
      due_date: (t.due_date as string) ?? null,
      assigned_employee_id: (t.assigned_employee_id as string) ?? null,
      assignee_name: a ? a.stage_name || [a.first_name, a.last_name].filter(Boolean).join(" ") : null,
      event_id: (t.event_id as string) ?? null,
      event_number: ev?.event_number ?? null,
      event_name: ev?.name ?? null,
      is_auto: !!t.rule_id,
      comment_count: commentCount.get(t.id as string) ?? 0,
    };
  });

  return (
    <div className="max-w-[1700px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Tasks Manager</h1>
          <p className="text-sm text-zinc-500">Your team&apos;s to-dos — auto-generated from rules or added by hand.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks" className="btn-primary px-3 py-1.5 text-sm">
            Tasks
          </Link>
          {canEdit && (
            <Link href="/tasks/settings" className="btn-ghost px-3 py-1.5 text-sm">
              Settings
            </Link>
          )}
        </div>
      </div>

      <TasksView
        tasks={tasks}
        staff={staff}
        departments={DEPARTMENTS as unknown as string[]}
        myEmployeeId={me?.employeeId ?? null}
        canEdit={canEdit}
      />
    </div>
  );
}
