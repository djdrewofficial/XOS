"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setTaskStatus,
  assignTask,
  deleteTask,
  addComment,
  getComments,
  createTask,
  runRulesNow,
  type TaskComment,
} from "./actions";

export type StaffOption = { id: string; name: string; department: string | null };
export type TaskCard = {
  id: string;
  title: string;
  body: string | null;
  status: "not_started" | "in_progress" | "done" | "dismissed";
  priority: "low" | "normal" | "high";
  department: string | null;
  due_date: string | null;
  assigned_employee_id: string | null;
  assignee_name: string | null;
  event_id: string | null;
  event_number: number | null;
  event_name: string | null;
  is_auto: boolean;
  comment_count: number;
};

const STATUS_META: Record<string, { label: string; dot: string; chip: string }> = {
  not_started: { label: "Not started", dot: "bg-zinc-400", chip: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  in_progress: { label: "In progress", dot: "bg-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  done: { label: "Done", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
};
const NEXT_STATUS: Record<string, TaskCard["status"]> = { not_started: "in_progress", in_progress: "done", done: "not_started" };

function fmtDue(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: "—", overdue: false };
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    text: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    overdue: d.getTime() < today.getTime(),
  };
}

export default function TasksView({
  tasks,
  staff,
  departments,
  myEmployeeId,
  canEdit,
}: {
  tasks: TaskCard[];
  staff: StaffOption[];
  departments: string[];
  myEmployeeId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | "not_started" | "in_progress" | "done">("open");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all"); // 'all' | 'unassigned' | <id>
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (tab === "mine" && t.assigned_employee_id !== myEmployeeId) return false;
      if (statusFilter === "open" && t.status === "done") return false;
      if (["not_started", "in_progress", "done"].includes(statusFilter) && t.status !== statusFilter) return false;
      if (assigneeFilter === "unassigned" && t.assigned_employee_id) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "unassigned" && t.assigned_employee_id !== assigneeFilter) return false;
      if (deptFilter !== "all" && t.department !== deptFilter) return false;
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [tasks, tab, statusFilter, assigneeFilter, deptFilter, q, myEmployeeId]);

  const groups = useMemo(() => {
    const order: TaskCard["status"][] = ["not_started", "in_progress", "done"];
    return order
      .map((s) => ({ status: s, items: filtered.filter((t) => t.status === s) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  function doRunRules() {
    setRunMsg(null);
    start(async () => {
      const res = await runRulesNow();
      setRunMsg(
        res.ok
          ? `Created ${res.created} task${res.created === 1 ? "" : "s"} · scanned ${res.events_scanned} events across ${res.rules_evaluated} rules.`
          : `Error: ${res.error ?? "run failed"}`,
      );
      refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-white/10">
            <button
              onClick={() => setTab("all")}
              className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "all" ? "bg-brand text-white" : "text-zinc-500"}`}
            >
              All Tasks
            </button>
            <button
              onClick={() => setTab("mine")}
              className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "mine" ? "bg-brand text-white" : "text-zinc-500"}`}
            >
              My Tasks
            </button>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks…"
            className="input h-8 w-48 text-sm"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input h-8 text-sm">
            <option value="open">Open (not done)</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="all">All statuses</option>
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="input h-8 text-sm">
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input h-8 text-sm">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              <button onClick={doRunRules} disabled={pending} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
                {pending ? "Running…" : "Run rules now"}
              </button>
            )}
            {canEdit && (
              <button onClick={() => setShowNew(true)} className="btn-primary px-3 py-1.5 text-sm">
                + New task
              </button>
            )}
          </div>
        </div>
        {runMsg && <div className="text-xs text-zinc-500">{runMsg}</div>}
      </div>

      {/* New task modal */}
      {showNew && (
        <NewTaskForm
          staff={staff}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">
          No tasks match these filters. {canEdit && "Add one, or set up rules in Settings to auto-generate them."}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.status} className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 dark:border-white/5">
              <span className={`h-2 w-2 rounded-full ${STATUS_META[g.status].dot}`} />
              <span className="text-sm font-semibold">{STATUS_META[g.status].label}</span>
              <span className="text-xs text-zinc-400">{g.items.length}</span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-white/5">
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  staff={staff}
                  canEdit={canEdit}
                  expanded={expanded === t.id}
                  onToggleExpand={() => setExpanded(expanded === t.id ? null : t.id)}
                  onChanged={refresh}
                  pendingGlobal={pending}
                  start={start}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TaskRow({
  task,
  staff,
  canEdit,
  expanded,
  onToggleExpand,
  onChanged,
  start,
}: {
  task: TaskCard;
  staff: StaffOption[];
  canEdit: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void;
  pendingGlobal: boolean;
  start: (cb: () => void) => void;
}) {
  const due = fmtDue(task.due_date);
  const done = task.status === "done";

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
        {/* status checkbox / cycle */}
        <button
          title={done ? "Mark not started" : "Advance status"}
          disabled={!canEdit}
          onClick={() => start(async () => { await setTaskStatus(task.id, done ? "not_started" : NEXT_STATUS[task.status]); onChanged(); })}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-white/20"
          } ${task.status === "in_progress" ? "border-blue-500" : ""} disabled:opacity-50`}
        >
          {done && <span className="text-[9px]">✓</span>}
          {task.status === "in_progress" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </button>

        <button onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <div className={`truncate text-sm ${done ? "text-zinc-400 line-through" : "font-medium"}`}>{task.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            {task.is_auto && <span className="rounded bg-brand/10 px-1.5 py-px text-brand">auto</span>}
            {task.priority === "high" && <span className="rounded bg-red-100 px-1.5 py-px text-red-600 dark:bg-red-950 dark:text-red-300">high</span>}
            {task.event_id && (
              <Link href={`/events/${task.event_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                {task.event_name || (task.event_number ? `#${task.event_number}` : "Event")}
              </Link>
            )}
            {task.department && <span>{task.department}</span>}
            {task.comment_count > 0 && <span>💬 {task.comment_count}</span>}
          </div>
        </button>

        <div className="hidden w-32 shrink-0 text-right text-xs text-zinc-500 sm:block">{task.assignee_name ?? "Unassigned"}</div>
        <div className={`hidden w-24 shrink-0 text-right text-xs sm:block ${due.overdue && !done ? "font-semibold text-red-500" : "text-zinc-500"}`}>
          {due.text}
        </div>
      </div>

      {expanded && (
        <TaskDetail task={task} staff={staff} canEdit={canEdit} onChanged={onChanged} start={start} />
      )}
    </div>
  );
}

function TaskDetail({
  task,
  staff,
  canEdit,
  onChanged,
  start,
}: {
  task: TaskCard;
  staff: StaffOption[];
  canEdit: boolean;
  onChanged: () => void;
  start: (cb: () => void) => void;
}) {
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);

  // refresh used by the add-comment handler (in an event callback, so sync setState is fine)
  function loadComments() {
    setLoading(true);
    getComments(task.id).then((c) => {
      setComments(c);
      setLoading(false);
    });
  }
  useEffect(() => {
    let alive = true;
    getComments(task.id).then((c) => {
      if (!alive) return;
      setComments(c);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [task.id]);

  return (
    <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-white/5 dark:bg-white/[0.015]">
      {task.body && <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{task.body}</p>}

      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="text-zinc-500">Assignee</label>
          <select
            defaultValue={task.assigned_employee_id ?? ""}
            onChange={(e) => start(async () => { await assignTask(task.id, e.target.value || null); onChanged(); })}
            className="input h-7 text-xs"
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="ml-2 text-zinc-500">Status</label>
          <select
            defaultValue={task.status}
            onChange={(e) => start(async () => { await setTaskStatus(task.id, e.target.value); onChanged(); })}
            className="input h-7 text-xs"
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="dismissed">Dismiss (hide)</option>
          </select>
          <button
            onClick={() => { if (confirm("Delete this task?")) start(async () => { await deleteTask(task.id); onChanged(); }); }}
            className="ml-auto text-red-500 hover:underline"
          >
            Delete
          </button>
        </div>
      )}

      {/* comments */}
      <div className="space-y-2">
        {loading && <div className="text-xs text-zinc-400">Loading comments…</div>}
        {comments?.map((c) => (
          <div key={c.id} className="text-xs">
            <span className="font-semibold text-zinc-600 dark:text-zinc-300">{c.author}</span>{" "}
            <span className="text-zinc-400">{new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <div className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{c.body}</div>
          </div>
        ))}
        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              className="input h-7 flex-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && comment.trim()) {
                  const body = comment;
                  setComment("");
                  start(async () => { await addComment(task.id, body); loadComments(); onChanged(); });
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NewTaskForm({ staff, onClose, onSaved }: { staff: StaffOption[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title mb-3">New task</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            await createTask(new FormData(e.currentTarget));
            setSaving(false);
            onSaved();
          }}
          className="space-y-3"
        >
          <div>
            <label className="label-xs">Title</label>
            <input name="title" required className="input w-full" placeholder="Follow up with the client…" />
          </div>
          <div>
            <label className="label-xs">Details (optional)</label>
            <textarea name="body" rows={2} className="input w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-xs">Assignee</label>
              <select name="assigned_employee_id" className="input w-full">
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs">Due date</label>
              <input type="date" name="due_date" className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Priority</label>
              <select name="priority" defaultValue="normal" className="input w-full">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button disabled={saving} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
              {saving ? "Saving…" : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
