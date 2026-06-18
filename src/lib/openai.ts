/* OpenAI helper — server-only. The API key never reaches the browser; all calls
   go through XOS server routes. Model defaults to the newest general model and
   is overridable via OPENAI_MODEL. */

export const ASSISTANT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type RawMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };

/** Low-level Chat Completions call returning the raw assistant message (so the
    caller can run a tool-calling loop). Sends only model + messages (+ tools) to
    stay compatible across the GPT-4o / GPT-5 families. */
export async function chatCompleteRaw(
  messages: unknown[],
  opts: { model?: string; tools?: ToolDef[] } = {},
): Promise<RawMessage> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const body: Record<string, unknown> = { model: opts.model || ASSISTANT_MODEL, messages };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { choices?: { message?: RawMessage }[] };
  return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
}

/** Convenience wrapper that returns just the text (no tools). */
export async function chatComplete(messages: ChatMessage[], opts: { model?: string } = {}): Promise<string> {
  const msg = await chatCompleteRaw(messages, opts);
  return msg.content ?? "";
}
