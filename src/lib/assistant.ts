/* Shared XOS Assistant engine — builds the KB-grounded system prompt and runs
   the OpenAI tool-calling loop. Used by both the web route (cookie auth) and the
   mobile route (Bearer-token auth); each handles its own auth + master-admin
   gate, then hands the request here with an RLS-scoped Supabase client. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatCompleteRaw } from "@/lib/openai";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistantTools";

export type AssistantMessage = { role?: string; content?: string };

export async function runAssistant(
  supabase: SupabaseClient,
  incoming: AssistantMessage[],
): Promise<string> {
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
    ...incoming
      .filter((m) => typeof m.content === "string")
      .slice(-12)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 4000),
      })),
  ];

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
    return msg.content ?? "";
  }
  return "";
}
