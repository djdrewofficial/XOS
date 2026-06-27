import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatComplete, isOpenAIConfigured } from "@/lib/openai";

// Whitelisted source columns (must match render_merge_tags in migration 00111).
const FIELDS = {
  poc_field: ["first_name", "last_name", "email", "phone", "planning_meeting_url", "website"],
  client_field: ["first_name", "last_name", "email", "cell_phone", "organization", "mailing_address"],
  event_field: ["name", "guest_count", "event_date", "start_time", "end_time", "setup_time"],
  company_field: ["company_name", "from_email", "reply_to", "legal_venue", "instagram_url", "tiktok_url"],
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOpenAIConfigured()) return NextResponse.json({ error: "OpenAI is not configured (OPENAI_API_KEY missing)." }, { status: 400 });

  const { request: ask } = await req.json();
  if (!ask || typeof ask !== "string") return NextResponse.json({ error: "Describe the tag you need." }, { status: 400 });

  const { data: tags } = await supabase.from("merge_tags").select("tag_key, label, group_name, description").eq("is_active", true).order("group_name");
  const catalog = (tags ?? []).map((t) => `<${t.tag_key}> — ${t.label} [${t.group_name}]${t.description ? `: ${t.description}` : ""}`).join("\n");

  const system = `You manage merge tags for a DJ/event company's email system. Merge tags look like <snake_case> and are replaced with real data when an email sends.

EXISTING TAGS:
${catalog}

The user describes a value they want in an email. Decide:
- If an existing tag already covers it, return a "match".
- Otherwise propose a new tag ("suggestion").

A new tag's source_type must be one of:
- "poc_field": data from the event's assigned Point of Contact (an employee). source_value ∈ ${JSON.stringify(FIELDS.poc_field)}
- "client_field": primary client data. source_value ∈ ${JSON.stringify(FIELDS.client_field)}
- "event_field": event data. source_value ∈ ${JSON.stringify(FIELDS.event_field)}
- "company_field": company-wide setting. source_value ∈ ${JSON.stringify(FIELDS.company_field)}
- "static": a fixed company-wide text/link the user will type in once (e.g. a Calendly link). Put a sensible placeholder or empty string in source_value.
- "needs_dev": the data is NOT stored in XOS yet, so a developer must add a field first. Explain in "note".

Respond with ONLY a JSON object, no prose, no code fences:
{"match": {"tag_key": "...", "reason": "..."} | null,
 "suggestion": {"tag_key": "snake_case_no_brackets", "label": "...", "group_name": "...", "description": "...", "source_type": "...", "source_value": "...", "note": "..."} | null}
Exactly one of match/suggestion is non-null.`;

  let raw = "";
  try {
    raw = await chatComplete([{ role: "system", content: system }, { role: "user", content: ask }]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed" }, { status: 502 });
  }

  // tolerate code fences / stray text around the JSON
  const json = raw.replace(/```json|```/g, "").trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(start >= 0 ? json.slice(start, end + 1) : json);
  } catch {
    return NextResponse.json({ error: "Could not parse AI response.", raw }, { status: 502 });
  }

  return NextResponse.json(parsed);
}
