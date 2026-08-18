import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { DEPARTMENTS } from "@/lib/taskRules";
import RulesClient, { type RuleRow, type Options } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function TaskSettingsPage() {
  const supabase = await createClient();
  await requireModule("tasks", "edit", { supabase });

  const [{ data: rules }, { data: types }, { data: journeys }, { data: statuses }, { data: venues }, { data: staff }, { data: addons }, { data: packages }] =
    await Promise.all([
      supabase.from("task_rules").select("*").order("created_at", { ascending: false }),
      supabase.from("event_types").select("name").eq("is_active", true).order("name"),
      supabase.from("journey_types").select("name").order("name"),
      supabase.from("event_statuses").select("name").order("sort_order", { ascending: true, nullsFirst: true }),
      supabase.from("venues").select("name").order("name"),
      supabase.from("employees").select("id,first_name,last_name,stage_name").eq("is_active", true).order("first_name"),
      supabase.from("addons").select("name").eq("is_active", true).order("name"),
      supabase.from("packages").select("name").eq("is_active", true).order("name"),
    ]);

  const options: Options = {
    event_types: (types ?? []).map((t) => t.name as string).filter(Boolean),
    journey_types: (journeys ?? []).map((j) => j.name as string).filter(Boolean),
    statuses: (statuses ?? []).map((s) => s.name as string).filter(Boolean),
    venues: (venues ?? []).map((v) => v.name as string).filter(Boolean),
    addons: (addons ?? []).map((a) => a.name as string).filter(Boolean),
    packages: (packages ?? []).map((p) => p.name as string).filter(Boolean),
    departments: DEPARTMENTS as unknown as string[],
    staff: (staff ?? []).map((s) => ({
      id: s.id as string,
      name: (s.stage_name as string) || [s.first_name, s.last_name].filter(Boolean).join(" "),
    })),
  };

  return (
    <div className="max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Tasks Manager · Settings</h1>
          <p className="text-sm text-zinc-500">
            Rules automatically create tasks based on dates and conditions. Describe one in plain English, or build it by hand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks" className="btn-ghost px-3 py-1.5 text-sm">
            Tasks
          </Link>
          <Link href="/tasks/settings" className="btn-primary px-3 py-1.5 text-sm">
            Settings
          </Link>
        </div>
      </div>

      <RulesClient rules={(rules ?? []) as RuleRow[]} options={options} />
    </div>
  );
}
