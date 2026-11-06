import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiMaster } from "@/lib/apiAuth";
import { isOpenAIConfigured } from "@/lib/openai";
import { runAssistant } from "@/lib/assistant";
import { ASSISTANT_CONTACT_BLOCKED, assistantTextHasDirectContact } from "@/lib/aiConsent";

export const dynamic = "force-dynamic";

/* XOS Assistant chat (web, cookie auth) — Master Admin only while in training. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const denied = await requireApiMaster(supabase);
  if (denied) return denied;
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
  if (incoming.some((message) => message.role !== "assistant" && assistantTextHasDirectContact(String(message.content ?? "")))) {
    return NextResponse.json({ error: ASSISTANT_CONTACT_BLOCKED }, { status: 400 });
  }

  try {
    const reply = await runAssistant(supabase, incoming);
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant error." }, { status: 502 });
  }
}
