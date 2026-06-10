import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StatusesPage() {
  const supabase = await createClient();
  const { data: statuses } = await supabase
    .from("event_statuses")
    .select("*")
    .order("sort_order");
  const { data: actions } = await supabase
    .from("daily_status_actions")
    .select("*, from:from_status_id(name), to:to_status_id(name)")
    .eq("is_active", true);

  const flag = (b: boolean) => (b ? "✓" : "");

  return (
    <div className="max-w-4xl">
      <h1 className="mb-5 text-2xl font-bold">Event Statuses</h1>

      <div className="mb-8 overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Color</th>
              <th className="px-4 py-2 text-center">Booked Group</th>
              <th className="px-4 py-2 text-center">Pending Group</th>
              <th className="px-4 py-2 text-center">Lost Sale Group</th>
              <th className="px-4 py-2 text-center">Leads Group</th>
            </tr>
          </thead>
          <tbody>
            {(statuses ?? []).map((s) => (
              <tr key={s.id} className="border-t border-zinc-100">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2">
                  <span
                    className="rounded px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: s.color, color: s.text_color }}
                  >
                    {s.color}
                  </span>
                </td>
                <td className="px-4 py-2 text-center text-green-700">{flag(s.is_booked_group)}</td>
                <td className="px-4 py-2 text-center text-amber-600">{flag(s.is_pending_group)}</td>
                <td className="px-4 py-2 text-center text-zinc-500">{flag(s.is_lost_sale_group)}</td>
                <td className="px-4 py-2 text-center text-blue-700">{flag(s.is_leads_group)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-violet-700">
        Daily Scheduled Actions
      </h2>
      <p className="mb-3 text-sm text-zinc-500">
        Status rollovers run nightly (mirrors DJEP&apos;s 4:00 AM CT actions). Beta 1 lists the rules;
        the scheduled runner ships in Beta 2 (Supabase pg_cron or edge function).
      </p>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">And Status Is</th>
              <th className="px-4 py-2">Change To</th>
            </tr>
          </thead>
          <tbody>
            {(actions ?? []).map((a) => (
              <tr key={a.id} className="border-t border-zinc-100">
                <td className="px-4 py-2">
                  {a.trigger_type === "event_date_passed" ? "Event date has passed" : "Contract due date has passed"}
                </td>
                <td className="px-4 py-2">{(a.from as { name: string } | null)?.name}</td>
                <td className="px-4 py-2 font-medium">{(a.to as { name: string } | null)?.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
