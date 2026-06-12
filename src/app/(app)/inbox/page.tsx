import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncHighLevelConversations } from "@/lib/highlevel";
import InboxShell, { type ConvRow } from "@/components/InboxShell";

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

  const { data: conversations } = await supabase
    .from("hl_conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(200);

  return <InboxShell conversations={(conversations ?? []) as ConvRow[]} active={null} />;
}
