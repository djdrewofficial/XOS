import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_LAYOUTS,
  sanitizeLayout,
  type LayoutItem,
  type Role,
} from "@/lib/dashboardWidgets";
import {
  StatCards,
  MonthCalendar,
  UpcomingEvents,
  RecentPayments,
  RecentNotifications,
  QuickActions,
  MyUpcomingEvents,
} from "@/components/dashboard/widgets";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const supabase = await createClient();

  // role of the signed-in user drives which layout renders
  const { data: auth } = await supabase.auth.getUser();
  const { data: me } = auth?.user
    ? await supabase.from("employees").select("permission_tier").eq("auth_user_id", auth.user.id).maybeSingle()
    : { data: null };
  const role = ((me?.permission_tier as Role | undefined) ?? "master_admin") as Role;

  const { data: layoutRow } = await supabase
    .from("dashboard_layouts")
    .select("widgets")
    .eq("role", role)
    .maybeSingle();

  let layout: LayoutItem[] = sanitizeLayout(layoutRow?.widgets);
  if (layout.length === 0) layout = DEFAULT_LAYOUTS[role];

  function renderWidget(id: string) {
    switch (id) {
      case "stat_cards":
        return <StatCards />;
      case "calendar":
        return <MonthCalendar m={m} />;
      case "upcoming_events":
        return <UpcomingEvents />;
      case "recent_payments":
        return <RecentPayments />;
      case "recent_notifications":
        return <RecentNotifications />;
      case "quick_actions":
        return <QuickActions />;
      case "my_upcoming_events":
        return <MyUpcomingEvents />;
      default:
        return null;
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="page-title mb-0">Dashboard</h1>
        <Link href="/settings/dashboard" className="text-xs font-semibold text-zinc-400 hover:text-brand dark:hover:text-brand-lighter">
          ✦ Edit Layout
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {layout.map((item) => (
          <div key={item.id} className={item.size === "full" ? "xl:col-span-2" : "min-w-0"}>
            {renderWidget(item.id)}
          </div>
        ))}
        {layout.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500 xl:col-span-2">
            No widgets configured for your role — add some in{" "}
            <Link href="/settings/dashboard" className="font-semibold text-brand underline dark:text-brand-lighter">
              Dashboard Layout
            </Link>.
          </p>
        )}
      </div>
    </div>
  );
}
