import { createClient } from "@/lib/supabase/server";
import {
  createStatus,
  updateStatus,
  deleteStatus,
  createDailyAction,
  toggleDailyAction,
  deleteDailyAction,
  runDailyActionsNow,
} from "./actions";

export const dynamic = "force-dynamic";

const GROUPS = [
  ["is_booked_group", "Booked", "Counts in financials + availability"],
  ["is_pending_group", "Pending", "Pending dashboards"],
  ["is_lost_sale_group", "Lost Sale", "Lost-sale reporting"],
  ["is_leads_group", "Leads", "Lead reporting"],
] as const;

export default async function StatusesPage() {
  const supabase = await createClient();
  const [{ data: statuses }, { data: actions }, { data: events }] = await Promise.all([
    supabase.from("event_statuses").select("*").order("sort_order"),
    supabase
      .from("daily_status_actions")
      .select("*, from:from_status_id(name, color, text_color), to:to_status_id(name, color, text_color)")
      .order("trigger_type"),
    supabase.from("events").select("status_id"),
  ]);

  const usage = new Map<string, number>();
  (events ?? []).forEach((e) => {
    if (e.status_id) usage.set(e.status_id, (usage.get(e.status_id) ?? 0) + 1);
  });

  return (
    <div className="max-w-6xl">
      <h1 className="page-title mb-5">Event Statuses</h1>

      {/* ---------- editable status rows ---------- */}
      <div className="card mb-3 overflow-hidden">
        <div className="table-head flex items-center py-2">
          <span className="w-[15%] px-3">Status Name</span>
          <span className="w-[11%] px-3">Preview</span>
          <span className="w-[6%] px-2 text-center">BG</span>
          <span className="w-[6%] px-2 text-center">Text</span>
          <span className="w-[6%] px-2 text-center">Order</span>
          {GROUPS.map(([key, label, hint]) => (
            <span key={key} className="w-[7%] text-center" title={hint}>
              {label}
            </span>
          ))}
          <span className="w-[6%] text-center">Active</span>
          <span className="w-[6%] text-center">In Use</span>
          <span className="w-[10%] px-3 text-right">Save</span>
        </div>
        {(statuses ?? []).map((s) => {
          const inUse = usage.get(s.id) ?? 0;
          return (
            <form
              key={s.id}
              action={updateStatus.bind(null, s.id)}
              className={`row flex w-full items-center py-1.5 ${!s.is_active ? "opacity-50" : ""}`}
            >
              <span className="w-[15%] px-3">
                <input name="name" defaultValue={s.name} className="input w-full py-1.5" />
              </span>
              <span className="w-[11%] overflow-hidden px-3 whitespace-nowrap">
                <span className="status-chip" style={{ backgroundColor: s.color, color: s.text_color }}>
                  {s.name}
                </span>
              </span>
              <span className="w-[6%] px-2">
                <input type="color" name="color" defaultValue={s.color} className="h-8 w-full cursor-pointer rounded border border-white/10 bg-transparent" />
              </span>
              <span className="w-[6%] px-2">
                <input type="color" name="text_color" defaultValue={s.text_color} className="h-8 w-full cursor-pointer rounded border border-white/10 bg-transparent" />
              </span>
              <span className="w-[6%] px-2">
                <input type="number" name="sort_order" defaultValue={s.sort_order} className="input w-full py-1.5 text-center" />
              </span>
              {GROUPS.map(([key]) => (
                <span key={key} className="w-[7%] text-center">
                  <input type="checkbox" name={key} defaultChecked={s[key]} className="size-4 accent-violet-500" />
                </span>
              ))}
              <span className="w-[6%] text-center">
                <input type="checkbox" name="is_active" defaultChecked={s.is_active} className="size-4 accent-violet-500" />
              </span>
              <span className="w-[6%] text-center text-xs text-zinc-500">{inUse > 0 ? inUse : "—"}</span>
              <span className="flex w-[10%] items-center justify-end gap-2 px-3">
                <button className="btn-ghost px-3 py-1 text-xs">Save</button>
                {inUse === 0 ? (
                  <button formAction={deleteStatus.bind(null, s.id)} className="text-xs font-semibold text-red-400 hover:underline">
                    Delete
                  </button>
                ) : (
                  <span className="text-xs text-zinc-700" title="In use — deactivate instead">🔒</span>
                )}
              </span>
            </form>
          );
        })}
      </div>
      <p className="mb-8 text-xs text-zinc-500">
        Group flags drive logic: <strong>Booked</strong> = financial calculations + availability, <strong>Leads</strong>/<strong>Lost Sale</strong> = dashboard stats, <strong>Pending</strong> = pending views. Statuses in use can&apos;t be deleted — uncheck Active instead.
      </p>

      {/* ---------- add status ---------- */}
      <h2 className="card-title">Add Status</h2>
      <form action={createStatus} className="card mb-10 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label-xs">Name</label>
          <input name="name" required className="input w-full" />
        </div>
        <div>
          <label className="label-xs">BG Color</label>
          <input type="color" name="color" defaultValue="#97CC9A" className="h-9 w-16 cursor-pointer rounded border border-white/10 bg-transparent" />
        </div>
        <div>
          <label className="label-xs">Text Color</label>
          <input type="color" name="text_color" defaultValue="#000000" className="h-9 w-16 cursor-pointer rounded border border-white/10 bg-transparent" />
        </div>
        <div>
          <label className="label-xs">Order</label>
          <input type="number" name="sort_order" defaultValue={99} className="input w-20" />
        </div>
        {GROUPS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 pb-2 text-xs text-zinc-400">
            <input type="checkbox" name={key} className="size-4 accent-violet-500" /> {label}
          </label>
        ))}
        <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-400">
          <input type="checkbox" name="is_active" defaultChecked className="size-4 accent-violet-500" /> Active
        </label>
        <button className="btn-primary">Add Status</button>
      </form>

      {/* ---------- daily scheduled actions ---------- */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="card-title mb-0">Daily Scheduled Actions</h2>
        <form action={runDailyActionsNow}>
          <button className="btn-ghost px-4 py-1.5 text-xs">▶ Run Now</button>
        </form>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        Status rollovers run automatically every night (4 AM ET via pg_cron), or on demand with Run Now.
      </p>
      <div className="card mb-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">And Status Is</th>
              <th className="px-4 py-2">Change To</th>
              <th className="px-4 py-2 text-center">Active</th>
              <th className="px-4 py-2 text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {(actions ?? []).map((a) => {
              const from = a.from as { name: string; color: string; text_color: string } | null;
              const to = a.to as { name: string; color: string; text_color: string } | null;
              return (
                <tr key={a.id} className={`row ${!a.is_active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    {a.trigger_type === "event_date_passed" ? "Event date has passed" : "Contract due date has passed"}
                  </td>
                  <td className="px-4 py-2.5">
                    {from && (
                      <span className="chip" style={{ backgroundColor: from.color, color: from.text_color }}>
                        {from.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {to && (
                      <span className="chip" style={{ backgroundColor: to.color, color: to.text_color }}>
                        {to.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <form action={toggleDailyAction.bind(null, a.id, !a.is_active)}>
                      <button className="text-xs font-semibold text-violet-300 hover:underline">
                        {a.is_active ? "✓ On — turn off" : "Off — turn on"}
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={deleteDailyAction.bind(null, a.id)}>
                      <button className="text-xs font-semibold text-red-400 hover:underline">Delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {(actions ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No scheduled actions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="card-title">Add Scheduled Action</h2>
      <form action={createDailyAction} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-52">
          <label className="label-xs">When</label>
          <select name="trigger_type" className="input w-full">
            <option value="event_date_passed">Event date has passed</option>
            <option value="contract_due_passed">Contract due date has passed</option>
          </select>
        </div>
        <div className="min-w-44">
          <label className="label-xs">And Status Is</label>
          <select name="from_status_id" required className="input w-full">
            <option value="">Select…</option>
            {(statuses ?? []).filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-44">
          <label className="label-xs">Change Status To</label>
          <select name="to_status_id" required className="input w-full">
            <option value="">Select…</option>
            {(statuses ?? []).filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary">Add Action</button>
      </form>
    </div>
  );
}
