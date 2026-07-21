import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshConversation, syncHighLevelConversations } from "@/lib/highlevel";
import { dispatchNotification } from "@/lib/notify";

/* Real-time inbound push from HighLevel (PUBLIC route — exempted in middleware).
   Wire it in GHL: Automation → Workflow, trigger "Customer Replied" →
   action "Custom Webhook": POST https://xos.xpressdjs.com/api/highlevel/webhook
   with header  x-xos-key: <CRON_SECRET>.
   The payload shape varies by trigger, so we parse defensively: refresh the
   exact conversation when we can identify it, otherwise run a light sync.
   Supabase Realtime then pushes the new rows into any open inbox. */

export const dynamic = "force-dynamic";

function findString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v) return v;
  }
  for (const v of Object.values(record)) {
    if (v && typeof v === "object") {
      const found = findString(v, keys);
      if (found) return found;
    }
  }
  return null;
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-xos-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    /* empty/non-JSON body still triggers a sync below */
  }

  const supabase = createAdminClient();
  const conversationId = findString(payload, ["conversationId", "conversation_id"]);
  const contactId = findString(payload, ["contactId", "contact_id"]);

  let target: string | null = conversationId;
  if (!target && contactId) {
    const { data } = await supabase
      .from("hl_conversations")
      .select("id")
      .eq("hl_contact_id", contactId)
      .maybeSingle();
    target = data?.id ?? null;
  }

  if (target) {
    await refreshConversation(supabase, target);
    // "Customer Replied" = an inbound message. Notify per settings (salesperson +
    // admins). Resolve the client's most recent live event so the event's
    // salesperson is targeted; falls back to role audiences if there's no event.
    try {
      const { data: conv } = await supabase.from("hl_conversations").select("client_id").eq("id", target).maybeSingle();
      let eventId: string | null = null;
      if (conv?.client_id) {
        const { data: ev } = await supabase
          .from("events")
          .select("id")
          .eq("client_id", conv.client_id)
          .is("archived_at", null)
          .order("event_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        eventId = (ev?.id as string | null) ?? null;
      }
      await dispatchNotification(supabase, "inbound_message", { eventId });
    } catch {
      /* notification is best-effort */
    }
    // bump unread so the list highlights without waiting for the next full sync
    return NextResponse.json({ refreshed: target });
  }

  // unknown/new conversation — pick it up with a light incremental sync
  const result = await syncHighLevelConversations(supabase, { maxPages: 1, claimSeconds: 5 });
  return NextResponse.json(result);
}
