import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isOpenAIConfigured } from "@/lib/openai";
import { runAssistant } from "@/lib/assistant";

export const dynamic = "force-dynamic";

/* XOS Assistant chat for the mobile app. Authenticates with the user's Supabase
   access token (Bearer header) instead of cookies — exempted from the cookie
   login-wall in middleware, verifies the token itself. Master Admin only while
   the assistant is in training. Mirrors the web /api/assistant/chat. */
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
    },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  // Master-Admin gate (mirrors getMe): no account/employee row ⇒ owner ⇒ master.
  const { data: account } = await supabase
    .from("accounts")
    .select("account_type, employee_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (account && account.account_type !== "staff") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const empQuery = account?.employee_id
    ? supabase.from("employees").select("permission_tier").eq("id", account.employee_id)
    : supabase.from("employees").select("permission_tier").eq("auth_user_id", userId);
  const { data: emp } = await empQuery.maybeSingle();
  const tier = (emp?.permission_tier as string | undefined) ?? "master_admin";
  if (tier !== "master_admin") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: "The assistant isn't configured yet." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: { role?: string; content?: string }[] };
  const incoming = (body.messages ?? []).filter((m) => m && typeof m.content === "string");
  if (!incoming.length) return NextResponse.json({ error: "No message." }, { status: 400 });

  try {
    const reply = await runAssistant(supabase, incoming);
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant error." }, { status: 502 });
  }
}
