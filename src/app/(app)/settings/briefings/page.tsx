import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import BriefingsClient, { type StaffRow, type GlobalCfg } from "./BriefingsClient";

export const dynamic = "force-dynamic";

const DEPT_RANK: Record<string, number> = {
  Administrators: 0,
  Salespeople: 1,
  Production: 2,
  "Live Musicians": 3,
  Subcontractors: 4,
};

export default async function BriefingsSettingsPage() {
  const supabase = await createClient();
  await requireModule("settings", "edit", { supabase });

  const [{ data: emps }, { data: prefs }, { data: task }] = await Promise.all([
    supabase
      .from("employees")
      .select("id,first_name,last_name,stage_name,email,staff_category")
      .eq("is_active", true),
    supabase.from("staff_briefing_prefs").select("employee_id,enabled,frequency,last_sent_on"),
    supabase.from("ai_tasks").select("enabled,config").eq("key", "staff_briefings").maybeSingle(),
  ]);

  const prefMap = new Map((prefs ?? []).map((p) => [p.employee_id as string, p]));

  const rows: StaffRow[] = (emps ?? [])
    .map((e) => {
      const p = prefMap.get(e.id as string);
      return {
        id: e.id as string,
        name: (e.stage_name as string) || [e.first_name, e.last_name].filter(Boolean).join(" "),
        department: (e.staff_category as string) ?? "—",
        email: (e.email as string) ?? null,
        enabled: (p?.enabled as boolean) ?? false,
        frequency: (p?.frequency as string) ?? "daily",
        last_sent_on: (p?.last_sent_on as string) ?? null,
      };
    })
    .sort((a, b) => (DEPT_RANK[a.department] ?? 9) - (DEPT_RANK[b.department] ?? 9) || a.name.localeCompare(b.name));

  const cfg = (task?.config as { hour?: number }) ?? {};
  const global: GlobalCfg = { enabled: (task?.enabled as boolean) ?? true, hour: cfg.hour ?? 7 };

  return (
    <div className="max-w-[1000px] space-y-5">
      <div>
        <h1 className="page-title">Daily Briefing</h1>
        <p className="text-sm text-zinc-500">
          A personalized morning email with each staffer&apos;s open tasks and upcoming events. Choose who gets it and how
          often. Tasks are generated at 5:30am so they&apos;re included in the briefing.
        </p>
      </div>
      <BriefingsClient rows={rows} global={global} />
    </div>
  );
}
