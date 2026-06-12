import { createClient } from "@/lib/supabase/server";
import Tabs from "@/components/Tabs";
import DashboardLayoutEditor from "@/components/DashboardLayoutEditor";
import {
  DEFAULT_LAYOUTS,
  ROLES,
  sanitizeLayout,
  type LayoutItem,
  type Role,
} from "@/lib/dashboardWidgets";
import { saveDashboardLayout } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayoutPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase.from("dashboard_layouts").select("role, widgets");

  if (error) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Dashboard Layout</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00033_dashboard_layouts.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const layoutFor = (role: Role): LayoutItem[] => {
    const row = (rows ?? []).find((r) => r.role === role);
    const layout = sanitizeLayout(row?.widgets);
    return layout.length > 0 ? layout : DEFAULT_LAYOUTS[role];
  };

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-2">Dashboard Layout</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Each role level gets its own dashboard. Pick the widgets, their order, and their width — more widgets unlock as
        new parts of XOS come online.
      </p>
      <Tabs
        tabs={ROLES.map(([role, label]) => ({
          id: role,
          label,
          badge: layoutFor(role).length,
          content: (
            <DashboardLayoutEditor
              key={role}
              initial={layoutFor(role)}
              action={saveDashboardLayout.bind(null, role)}
            />
          ),
        }))}
      />
    </div>
  );
}
