import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule, getMe } from "@/lib/auth";
import { DEPARTMENTS } from "@/lib/taskRules";
import TasksView, { type TaskCard, type StaffOption, type EventOption } from "./TasksView";

export const dynamic = "force-dynamic";

const usDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) : "";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const supabase = await createClient();
  await requireModule("tasks", "view", { supabase });
  const me = await getMe(supabase);
  const canEdit = me?.can["tasks"] === "edit";
  const { task: openTaskId } = await searchParams;

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const todayMinus1y = cutoff.toISOString().slice(0, 10);

  const [{ data: rawTasks }, { data: rawStaff }, { data: counts }, { data: rawEvents }] = await Promise.all([
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
    supabase
      .from("events")
      .select(
        `id,event_number,name,event_date,
         event_type:event_types(name),
         event_clients(is_primary,client:clients(first_name))`,
      )
      .is("archived_at", null)
      .gte("event_date", todayMinus1y)
      .order("event_date", { ascending: false })
      .limit(500),
  ]);

  const commentCount = new Map<string, number>();
  for (const c of counts ?? []) {
    const k = c.task_id as string;
    commentCount.set(k, (commentCount.get(k) ?? 0) + 1);
  }

  // Active staff only (query filters is_active), ordered so Administrators &
  // Salespeople surface first in every dropdown, then the rest, then by name.
  const DEPT_RANK: Record<string, number> = {
    Administrators: 0,
    Salespeople: 1,
    Production: 2,
    "Live Musicians": 3,
    Subcontractors: 4,
  };
  const staff: StaffOption[] = (rawStaff ?? [])
    .map((s) => ({
      id: s.id as string,
      name: (s.stage_name as string) || [s.first_name, s.last_name].filter(Boolean).join(" "),
      department: (s.staff_category as string) ?? null,
    }))
    .sort(
      (a, b) =>
        (DEPT_RANK[a.department ?? ""] ?? 9) - (DEPT_RANK[b.department ?? ""] ?? 9) ||
        a.name.localeCompare(b.name),
    );

  const events: EventOption[] = (rawEvents ?? []).map((e) => {
    const names = ((e.event_clients as unknown as { is_primary?: boolean; client?: { first_name?: string } }[]) ?? [])
      .slice()
      .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
      .map((ec) => ec.client?.first_name)
      .filter(Boolean)
      .join(" & ");
    const type = (e.event_type as unknown as { name?: string } | null)?.name ?? "Event";
    const date = usDate(e.event_date as string | null);
    const label = names ? `${names} · ${type}${date ? ` (${date})` : ""}` : (e.name as string) || `#${e.event_number}`;
    return { id: e.id as string, label };
  });

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
        events={events}
        departments={DEPARTMENTS as unknown as string[]}
        myEmployeeId={me?.employeeId ?? null}
        canEdit={canEdit}
        initialOpenTaskId={openTaskId ?? null}
      />
    </div>
  );
}
