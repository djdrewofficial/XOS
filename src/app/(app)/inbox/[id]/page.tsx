import { notFound } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/highlevel";
import InboxShell, { type ActiveThread, type ConvRow, type MsgRow } from "@/components/InboxShell";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: conversations }, { data: conv }, { data: clientList }] = await Promise.all([
    supabase
      .from("hl_conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(200),
    supabase.from("hl_conversations").select("*").eq("id", id).maybeSingle(),
    supabase.from("clients").select("id, first_name, last_name, cell_phone").order("first_name"),
  ]);
  if (!conv) notFound();

  const [{ data: messages }, { data: client }] = await Promise.all([
    supabase
      .from("hl_messages")
      .select("*")
      .eq("conversation_id", id)
      .order("date_added", { ascending: true })
      .limit(500),
    conv.client_id
      ? supabase
          .from("clients")
          .select("id, first_name, last_name, cell_phone, email")
          .eq("id", conv.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: events } = client
    ? await supabase
        .from("events")
        .select("id, name, event_date, status:event_statuses(name, color, text_color)")
        .eq("client_id", client.id)
        .order("event_date", { ascending: false })
        .limit(10)
    : { data: [] };

  // documents attachable to email replies (from this client's events)
  const eventIds = (events ?? []).map((ev) => ev.id as string);
  const { data: docs } = eventIds.length
    ? await supabase
        .from("documents")
        .select("id, title")
        .in("event_id", eventIds)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  // freshen this thread + clear unread AFTER render; realtime delivers updates
  after(async () => {
    const admin = createAdminClient();
    await refreshConversation(admin, id);
    await admin.from("hl_conversations").update({ unread_count: 0 }).eq("id", id);
  });

  const active: ActiveThread = {
    conv: conv as ConvRow,
    messages: (messages ?? []) as MsgRow[],
    client: client ?? null,
    events: (events ?? []).map((ev) => {
      const status = ev.status as unknown as { name: string; color: string; text_color: string } | null;
      return {
        id: ev.id as string,
        name: ev.name as string,
        event_date: (ev.event_date as string) ?? null,
        status_name: status?.name ?? null,
        status_color: status?.color ?? null,
        status_text_color: status?.text_color ?? null,
      };
    }),
    ghlUrl:
      conv.hl_contact_id && process.env.HIGHLEVEL_LOCATION_ID
        ? `https://app.gohighlevel.com/v2/location/${process.env.HIGHLEVEL_LOCATION_ID}/contacts/detail/${conv.hl_contact_id}`
        : null,
    docs: (docs ?? []) as { id: string; title: string }[],
  };

  return (
    <InboxShell
      conversations={(conversations ?? []) as ConvRow[]}
      active={active}
      clients={clientList ?? []}
    />
  );
}
