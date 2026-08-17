"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  updateTask,
  type TaskComment,
} from "./actions";

export type StaffOption = { id: string; name: string; department: string | null };
export type EventOption = { id: string; label: string };
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

const STATUS_META: Record<string, { label: string; dot: string }> = {
  not_started: { label: "Not started", dot: "bg-zinc-400" },
  in_progress: { label: "In progress", dot: "bg-blue-500" },
  done: { label: "Done", dot: "bg-emerald-500" },
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
  events,
  departments,
  myEmployeeId,
  canEdit,
  initialOpenTaskId,
}: {
  tasks: TaskCard[];
  staff: StaffOption[];
  events: EventOption[];
  departments: string[];
  myEmployeeId: string | null;
  canEdit: boolean;
  initialOpenTaskId: string | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  // local mirror of server rows → instant (optimistic) UI, reconciled on refresh.
  // Sync when the server props change, using React's adjust-state-on-prop-change
  // pattern (no effect) so an optimistic edit is superseded by fresh server data.
  const [items, setItems] = useState<TaskCard[]>(tasks);
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setItems(tasks);
  }
  const patchLocal = (id: string, patch: Partial<TaskCard>) =>
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeLocal = (id: string) => setItems((prev) => prev.filter((t) => t.id !== id));

  const [tab, setTab] = useState<"all" | "mine">("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | "not_started" | "in_progress" | "done">("open");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenTaskId);
  const [showNew, setShowNew] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = () => router.refresh();

  // ---- optimistic mutations ----
  const changeStatus = (id: string, status: TaskCard["status"]) => {
    patchLocal(id, { status });
    start(async () => {
      await setTaskStatus(id, status);
      refresh();
    });
  };
  const changeAssignee = (id: string, empId: string | null) => {
    const s = staff.find((x) => x.id === empId);
    patchLocal(id, { assigned_employee_id: empId, assignee_name: s?.name ?? null, department: s?.department ?? null });
    start(async () => {
      await assignTask(id, empId);
      refresh();
    });
  };
  const removeTask = (id: string) => {
    removeLocal(id);
    setOpenId(null);
    start(async () => {
      await deleteTask(id);
      refresh();
    });
  };
  const saveDetails = (id: string, patch: { body?: string | null; due_date?: string | null; priority?: string; event_id?: string | null }) => {
    const local: Partial<TaskCard> = {};
    if (patch.body !== undefined) local.body = patch.body ?? null;
    if (patch.due_date !== undefined) local.due_date = patch.due_date ?? null;
    if (patch.priority !== undefined) local.priority = patch.priority as TaskCard["priority"];
    if (patch.event_id !== undefined) {
      local.event_id = patch.event_id ?? null;
      if (!patch.event_id) {
        local.event_name = null;
        local.event_number = null;
      }
    }
    patchLocal(id, local);
    start(async () => {
      await updateTask(id, patch);
      refresh();
    });
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((t) => {
      if (tab === "mine" && t.assigned_employee_id !== myEmployeeId) return false;
      if (statusFilter === "open" && t.status === "done") return false;
      if (["not_started", "in_progress", "done"].includes(statusFilter) && t.status !== statusFilter) return false;
      if (assigneeFilter === "unassigned" && t.assigned_employee_id) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "unassigned" && t.assigned_employee_id !== assigneeFilter) return false;
      if (deptFilter !== "all" && t.department !== deptFilter) return false;
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, tab, statusFilter, assigneeFilter, deptFilter, q, myEmployeeId]);

  const groups = useMemo(() => {
    const order: TaskCard["status"][] = ["not_started", "in_progress", "done"];
    return order
      .map((s) => ({ status: s, items: filtered.filter((t) => t.status === s) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  function doRunRules() {
    setRunMsg(null);
    setRunning(true);
    start(async () => {
      const res = await runRulesNow();
      setRunMsg(
        res.ok
          ? `Created ${res.created} task${res.created === 1 ? "" : "s"} · scanned ${res.events_scanned} events across ${res.rules_evaluated} rules.`
          : `Error: ${res.error ?? "run failed"}`,
      );
      setRunning(false);
      refresh();
    });
  }

  const openTask = items.find((t) => t.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-white/10">
            <button onClick={() => setTab("all")} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "all" ? "bg-brand text-white" : "text-zinc-500"}`}>
              All Tasks
            </button>
            <button onClick={() => setTab("mine")} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "mine" ? "bg-brand text-white" : "text-zinc-500"}`}>
              My Tasks
            </button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="input w-48 text-sm" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input text-sm">
            <option value="open">Open (not done)</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="all">All statuses</option>
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="input text-sm">
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input text-sm">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              <button onClick={doRunRules} disabled={running} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
                {running ? "Running…" : "Run rules now"}
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

      {showNew && (
        <NewTaskForm
          staff={staff}
          events={events}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}

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
                <TaskRow key={t.id} task={t} canEdit={canEdit} onOpen={() => setOpenId(t.id)} onQuickStatus={changeStatus} />
              ))}
            </div>
          </div>
        ))
      )}

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          task={openTask}
          staff={staff}
          events={events}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onStatus={changeStatus}
          onAssignee={changeAssignee}
          onSave={saveDetails}
          onDelete={removeTask}
          onCommented={(id) => patchLocal(id, { comment_count: openTask.comment_count + 1 })}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  canEdit,
  onOpen,
  onQuickStatus,
}: {
  task: TaskCard;
  canEdit: boolean;
  onOpen: () => void;
  onQuickStatus: (id: string, status: TaskCard["status"]) => void;
}) {
  const due = fmtDue(task.due_date);
  const done = task.status === "done";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
      <button
        title={done ? "Mark not started" : "Advance status"}
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          onQuickStatus(task.id, done ? "not_started" : NEXT_STATUS[task.status]);
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-white/20"
        } ${task.status === "in_progress" ? "border-blue-500" : ""} disabled:opacity-50`}
      >
        {done && <span className="text-[9px]">✓</span>}
        {task.status === "in_progress" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </button>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-sm ${done ? "text-zinc-400 line-through" : "font-medium"}`}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          {task.is_auto && <span className="rounded bg-brand/10 px-1.5 py-px text-brand">auto</span>}
          {task.priority === "high" && <span className="rounded bg-red-100 px-1.5 py-px text-red-600 dark:bg-red-950 dark:text-red-300">high</span>}
          {task.event_id && <span>{task.event_name || (task.event_number ? `#${task.event_number}` : "Event")}</span>}
          {task.department && <span>{task.department}</span>}
          {task.comment_count > 0 && <span>💬 {task.comment_count}</span>}
        </div>
      </button>

      <div className="hidden w-32 shrink-0 text-right text-xs text-zinc-500 sm:block">{task.assignee_name ?? "Unassigned"}</div>
      <div className={`hidden w-24 shrink-0 text-right text-xs sm:block ${due.overdue && !done ? "font-semibold text-red-500" : "text-zinc-500"}`}>
        {due.text}
      </div>
    </div>
  );
}

function TaskDrawer({
  task,
  staff,
  events,
  canEdit,
  onClose,
  onStatus,
  onAssignee,
  onSave,
  onDelete,
  onCommented,
}: {
  task: TaskCard;
  staff: StaffOption[];
  events: EventOption[];
  canEdit: boolean;
  onClose: () => void;
  onStatus: (id: string, status: TaskCard["status"]) => void;
  onAssignee: (id: string, empId: string | null) => void;
  onSave: (id: string, patch: { body?: string | null; due_date?: string | null; priority?: string; event_id?: string | null }) => void;
  onDelete: (id: string) => void;
  onCommented: (id: string) => void;
}) {
  // drawer is keyed by task.id at the call site, so it remounts per task → these
  // initialize fresh from props without a syncing effect.
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [desc, setDesc] = useState(task.body ?? "");
  const [descDirty, setDescDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    getComments(task.id).then((c) => {
      if (alive) setComments(c);
    });
    return () => {
      alive = false;
    };
  }, [task.id]);

  function reloadComments() {
    getComments(task.id).then(setComments);
  }

  const due = fmtDue(task.due_date);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-2 border-b border-zinc-100 p-4 dark:border-white/5">
          <div className="min-w-0">
            <div className="text-base font-semibold">{task.title}</div>
            {task.event_id && (
              <Link href={`/events/${task.event_id}`} className="text-xs text-brand hover:underline">
                {task.event_name || (task.event_number ? `#${task.event_number}` : "Open event")} →
              </Link>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Properties */}
          <div className="space-y-2 text-sm">
            <Field label="Status">
              <select
                disabled={!canEdit}
                value={task.status}
                onChange={(e) => onStatus(task.id, e.target.value as TaskCard["status"])}
                className="input w-full text-sm"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
                <option value="dismissed">Dismiss (hide)</option>
              </select>
            </Field>
            <Field label="Assignee">
              <select
                disabled={!canEdit}
                value={task.assigned_employee_id ?? ""}
                onChange={(e) => onAssignee(task.id, e.target.value || null)}
                className="input w-full text-sm"
              >
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Event">
              <EventPicker
                events={events}
                value={task.event_id}
                disabled={!canEdit}
                onChange={(id) => onSave(task.id, { event_id: id })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Due date">
                <input
                  type="date"
                  disabled={!canEdit}
                  defaultValue={task.due_date ?? ""}
                  onChange={(e) => onSave(task.id, { due_date: e.target.value || null })}
                  className="input w-full text-sm"
                />
                {due.overdue && task.status !== "done" && <span className="text-[11px] text-red-500">Overdue</span>}
              </Field>
              <Field label="Priority">
                <select
                  disabled={!canEdit}
                  value={task.priority}
                  onChange={(e) => onSave(task.id, { priority: e.target.value })}
                  className="input w-full text-sm"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Description</div>
            <textarea
              value={desc}
              disabled={!canEdit}
              onChange={(e) => {
                setDesc(e.target.value);
                setDescDirty(true);
              }}
              onBlur={() => {
                if (descDirty) {
                  onSave(task.id, { body: desc });
                  setDescDirty(false);
                }
              }}
              rows={4}
              placeholder="Add details…"
              className="input w-full text-sm"
            />
          </div>

          {/* Comments */}
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Comments</div>
            <div className="space-y-3">
              {comments === null && <div className="text-xs text-zinc-400">Loading…</div>}
              {comments?.length === 0 && <div className="text-xs text-zinc-400">No comments yet.</div>}
              {comments?.map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="text-xs">
                    <span className="font-semibold text-zinc-600 dark:text-zinc-300">{c.author}</span>{" "}
                    <span className="text-zinc-400">
                      {new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{c.body}</div>
                </div>
              ))}
            </div>
            {canEdit && (
              <MentionComposer
                staff={staff}
                onSend={async (text, mentions) => {
                  await addComment(task.id, text, mentions);
                  onCommented(task.id);
                  reloadComments();
                }}
              />
            )}
          </div>
        </div>

        {canEdit && (
          <div className="border-t border-zinc-100 p-3 dark:border-white/5">
            <button
              onClick={() => {
                if (confirm("Delete this task?")) onDelete(task.id);
              }}
              className="text-xs text-red-500 hover:underline"
            >
              Delete task
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

function EventPicker({
  events,
  value,
  disabled,
  onChange,
}: {
  events: EventOption[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = events.find((e) => e.id === value) ?? null;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    return (n ? events.filter((e) => e.label.toLowerCase().includes(n)) : events).slice(0, 25);
  }, [events, query]);

  return (
    <div className="relative" ref={boxRef}>
      <input
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder="No event linked — search…"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        className="input w-full text-sm"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10"
          >
            — No event —
          </button>
          {filtered.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onChange(e.id);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              {e.label}
            </button>
          ))}
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-zinc-400">No matches.</div>}
        </div>
      )}
    </div>
  );
}

function MentionComposer({
  staff,
  onSend,
}: {
  staff: StaffOption[];
  onSend: (text: string, mentions: string[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [menu, setMenu] = useState<string | null>(null); // current @query, or null
  const [sending, setSending] = useState(false);

  const suggestions = useMemo(() => {
    if (menu === null) return [];
    const n = menu.toLowerCase();
    return staff.filter((s) => s.name.toLowerCase().includes(n)).slice(0, 6);
  }, [menu, staff]);

  function onChange(v: string) {
    setText(v);
    const m = v.match(/@([\w ]*)$/);
    setMenu(m ? m[1] : null);
  }

  function pick(s: StaffOption) {
    setText((t) => t.replace(/@([\w ]*)$/, `@${s.name} `));
    setMentions((prev) => (prev.some((m) => m.id === s.id) ? prev : [...prev, { id: s.id, name: s.name }]));
    setMenu(null);
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    // only keep mentions whose name still appears in the text
    const kept = mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
    await onSend(t, kept);
    setText("");
    setMentions([]);
    setMenu(null);
    setSending(false);
  }

  return (
    <div className="relative mt-3">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full mb-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
          {suggestions.map((s) => (
            <button key={s.id} onClick={() => pick(s)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10">
              {s.name} <span className="text-[11px] text-zinc-400">{s.department}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Add a comment…  Type @ to tag a teammate"
        className="input w-full text-sm"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{mentions.length > 0 ? `Tagging: ${mentions.map((m) => m.name).join(", ")}` : "@ to tag"}</span>
        <button onClick={send} disabled={sending || !text.trim()} className="btn-primary px-3 py-1 text-xs disabled:opacity-50">
          {sending ? "Sending…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

function NewTaskForm({
  staff,
  events,
  onClose,
  onSaved,
}: {
  staff: StaffOption[];
  events: EventOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title mb-3">New task</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            const fd = new FormData(e.currentTarget);
            if (eventId) fd.set("event_id", eventId);
            await createTask(fd);
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
          <div>
            <label className="label-xs">Link to event (optional)</label>
            <EventPicker events={events} value={eventId} onChange={setEventId} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-xs">Assignee</label>
              <select name="assigned_employee_id" className="input w-full">
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
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
