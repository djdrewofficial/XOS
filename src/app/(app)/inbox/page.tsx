import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncHighLevelConversations } from "@/lib/highlevel";
import InboxShell, { type ConvRow } from "@/components/InboxShell";
import { getMe } from "@/lib/auth";
import { djClientIds } from "@/lib/fieldStaff";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();

  // opportunistic sync AFTER the response renders — never blocks the page;
  // realtime pushes whatever it finds into the already-open UI
  const { data: state } = await supabase
    .from("hl_sync_state")
    .select("last_synced_at")
    .eq("id", true)
    .maybeSingle();
  const staleMs = state?.last_synced_at
    ? Date.now() - new Date(state.last_synced_at).getTime()
    : Infinity;
  if (staleMs > 2 * 60 * 1000) {
    after(async () => {
      await syncHighLevelConversations(createAdminClient());
    });
  }

  // Only the columns the list needs (avoids shipping every conversation column).
  // Clients for the "New conversation" picker load lazily on demand in the shell.
  // field staff: only clients of events where their role contains "DJ" (00217)
  const me = await getMe(supabase);
  const scope = me?.fieldStaff ? await djClientIds(supabase) : null;
  const listQuery = supabase
    .from("hl_conversations")
    .select("id, hl_contact_id, client_id, contact_name, phone, email, last_message_at, last_message_direction, last_message_type, last_message_body, unread_count");
  if (scope) listQuery.in("client_id", scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]);
  const { data: conversations } = await listQuery
    .order("last_message_at", { ascending: false })
    .limit(200);

  return (
    <InboxShell
      conversations={(conversations ?? []) as ConvRow[]}
      active={null}
      clients={[]}
    />
  );
}
