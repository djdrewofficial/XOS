import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventForm from "@/components/EventForm";
import { updateEvent } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: event }, { data: clients }, { data: venues }, { data: packages }, { data: statuses }, { data: types }, { data: sources }] =
    await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("clients").select("id, first_name, last_name").order("first_name"),
      supabase.from("venues").select("id, name").order("name"),
      supabase.from("packages").select("id, name").eq("is_active", true).order("display_order"),
      supabase.from("event_statuses").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
      supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    ]);

  if (!event) notFound();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-5 text-2xl font-bold">Edit Event</h1>
      <EventForm
        event={event}
        action={updateEvent.bind(null, id)}
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
