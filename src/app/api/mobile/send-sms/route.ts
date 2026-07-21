import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { processSmsOutbox, refreshConversation } from "@/lib/highlevel";

/* Mobile-app SMS send. The XOS Mobile app authenticates with the user's
   Supabase access token (Bearer header) instead of cookies, so this route is
   exempted from the cookie login-wall in middleware and verifies the token
   itself. Mirrors sendInboxReply in src/app/(app)/inbox/actions.ts, INCLUDING
   its requireModule("inbox","edit") gate — otherwise a staffer restricted from
   the inbox on the web could still send company SMS from the app. */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Anon-key client carrying the user's JWT — RLS-authenticated, like the web session.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  // Same per-screen RBAC the web inbox enforces (JWT verified inside).
  const denied = await requireMobileStaffModule(supabase, token, "inbox", "edit");
  if (denied) return denied;

  const { conversationId, body } = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    body?: string;
  };
  const text = (body ?? "").toString().trim();
  if (!conversationId || !text) {
    return NextResponse.json({ error: "conversationId and body are required" }, { status: 400 });
  }

  const { data: conv } = await supabase
    .from("hl_conversations")
    .select("id, phone, client_id")
    .eq("id", conversationId)
    .single();
  if (!conv?.phone) {
    return NextResponse.json(
      { error: "This conversation has no phone number to text." },
      { status: 422 }
    );
  }

  const { error } = await supabase.from("sms_log").insert({
    client_id: conv.client_id,
    to_number: conv.phone,
    body: text,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await processSmsOutbox(supabase);
  await refreshConversation(supabase, conversationId);
  return NextResponse.json({ ok: true });
}
