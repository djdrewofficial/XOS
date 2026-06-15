import { createClient } from "@/lib/supabase/server";
import NewEventForm from "@/components/NewEventForm";
import { createEventOnboarding } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const supabase = await createClient();
  const [
    { data: roles },
    { data: types },
    { data: statuses },
    { data: sources },
    { data: packages },
    { data: addons },
    { data: employees },
    { data: dateDefs },
  ] = await Promise.all([
    supabase.from("client_role_definitions").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("packages").select("id, name, default_price, deposit_value, allowed_splits").eq("is_active", true).order("display_order"),
    supabase.from("addons").select("id, name, default_price").eq("is_active", true).order("display_order"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("custom_date_definitions").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="page-title mb-5">Add Event</h1>
      <NewEventForm
        action={createEventOnboarding}
        roles={roles ?? []}
        eventTypes={types ?? []}
        statuses={statuses ?? []}
        inquirySources={sources ?? []}
        packages={(packages ?? []) as { id: string; name: string; default_price: number; deposit_value: number; allowed_splits: number[] | null }[]}
        addons={(addons ?? []) as { id: string; name: string; default_price: number }[]}
        employees={(employees ?? []) as { id: string; first_name: string; last_name: string }[]}
        customDateDefs={dateDefs ?? []}
      />
    </div>
  );
}
