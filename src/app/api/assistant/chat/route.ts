import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { chatCompleteRaw, isOpenAIConfigured } from "@/lib/openai";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistantTools";

export const dynamic = "force-dynamic";

/* XOS Assistant chat — Master Admin only (for now, while it's being trained).
   Grounds every answer in the active KB articles authored in Settings. */
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

  const { data: kb } = await supabase
    .from("kb_articles")
    .select("title, category, content")
    .eq("is_active", true)
    .order("sort_order")
    .order("title");

  const kbText =
    (kb ?? []).map((a) => `### ${a.title}${a.category ? ` (${a.category})` : ""}\n${a.content}`).join("\n\n") ||
    "(The knowledge base is empty — answer from general knowledge of XOS and say when you're unsure.)";

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  const system = `You are the XOS Assistant for Xpress Entertainment, a South Florida DJ & events company. You help staff use XOS (their internal CRM/operations app) and answer company questions. Be concise, friendly, and practical.

Today is ${today} (America/New_York). For any availability or scheduling question, USE the check_availability or list_events tools — never guess about dates. Those tools return event data WITHOUT client personal information (no names, contacts, or addresses), so do not claim to know who a client is. A date is "open" when nothing on it blocks availability.

Ground non-calendar answers in the KNOWLEDGE BASE below; if something isn't there, say you're not certain and suggest where to look rather than inventing specifics. Never fabricate prices, policies, or steps.

=== KNOWLEDGE BASE ===
${kbText}`;

  const convo: unknown[] = [
    { role: "system", content: system },
    ...incoming.slice(-12).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content).slice(0, 4000),
    })),
  ];

  try {
    let reply = "";
    for (let i = 0; i < 5; i++) {
      const msg = await chatCompleteRaw(convo, { tools: ASSISTANT_TOOLS });
      if (msg.tool_calls?.length) {
        convo.push(msg);
        for (const tc of msg.tool_calls) {
          let a: Record<string, unknown> = {};
          try { a = JSON.parse(tc.function.arguments || "{}"); } catch { a = {}; }
          const result = await runAssistantTool(tc.function.name, a, supabase);
          convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
        }
        continue;
      }
      reply = msg.content ?? "";
      break;
    }
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assistant error." }, { status: 502 });
  }
}
