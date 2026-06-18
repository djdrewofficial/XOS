import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { isOpenAIConfigured } from "@/lib/openai";
import { runAssistant } from "@/lib/assistant";

export const dynamic = "force-dynamic";

/* XOS Assistant chat (web, cookie auth) — Master Admin only while in training. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: "The assistant isn't configured yet (missing OpenAI key)." }, { status: 503 });
  }

  let body: { messages?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const incoming = (body.messages ?? []).filter((m) => m && typeof m.content === "string");
  if (!incoming.length) return NextResponse.json({ error: "No message." }, { status: 400 });

  try {
    const reply = await runAssistant(supabase, incoming);
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant error." }, { status: 502 });
  }
}
