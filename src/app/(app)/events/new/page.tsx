import { createClient } from "@/lib/supabase/server";
import EventForm from "@/components/EventForm";
import { createEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const supabase = await createClient();
  const [{ data: clients }, { data: venues }, { data: packages }, { data: statuses }, { data: types }, { data: sources }] =
    await Promise.all([
      supabase.from("clients").select("id, first_name, last_name").order("first_name"),
      supabase.from("venues").select("id, name").order("name"),
      supabase.from("packages").select("id, name").eq("is_active", true).order("display_order"),
      supabase.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
      supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    ]);

  return (
    <div className="max-w-4xl">
      <h1 className="mb-5 text-2xl font-bold">Add Event</h1>
      <EventForm
        action={createEvent}
        clients={clients ?? []}
        venues={venues ?? []}
        packages={packages ?? []}
        statuses={statuses ?? []}
        eventTypes={types ?? []}
        inquirySources={sources ?? []}
      />
    </div>
  );
}
