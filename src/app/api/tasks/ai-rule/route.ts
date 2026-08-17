import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiModule } from "@/lib/apiAuth";
import { chatComplete, isOpenAIConfigured } from "@/lib/openai";
import { TRIGGER_ANCHORS, ASSIGNEE_TYPES, DEPARTMENTS, CONDITION_FIELDS } from "@/lib/taskRules";

/* Plain-English → structured task rule. Mirrors the merge-tag-wizard: enumerate the
   allowed vocabulary as whitelists in the prompt, demand strict JSON, parse tolerantly.
   The returned draft pre-fills the rule builder form for the user to review + save. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const denied = await requireApiModule("tasks", "edit", supabase);
  if (denied) return denied;
  if (!isOpenAIConfigured())
    return NextResponse.json({ error: "OpenAI is not configured (OPENAI_API_KEY missing)." }, { status: 400 });

  const { request: ask } = await req.json();
  if (!ask || typeof ask !== "string")
    return NextResponse.json({ error: "Describe the task automation you want." }, { status: 400 });

  // Real option lists so the model emits values that exist in this database.
  const [{ data: types }, { data: journeys }, { data: statuses }, { data: emps }] = await Promise.all([
    supabase.from("event_types").select("name").eq("is_active", true),
    supabase.from("journey_types").select("name"),
    supabase.from("event_statuses").select("name"),
    supabase.from("employees").select("id,first_name,last_name,stage_name").eq("is_active", true),
  ]);
  const typeNames = (types ?? []).map((t) => t.name);
  const journeyNames = (journeys ?? []).map((j) => j.name);
  const statusNames = (statuses ?? []).map((s) => s.name);
  const staffList = (emps ?? []).map(
    (e) => `${e.id} = ${e.stage_name || [e.first_name, e.last_name].filter(Boolean).join(" ")}`,
  );

  const fieldDocs = CONDITION_FIELDS.map((f) => {
    let ops = "";
    if (f.kind === "boolean") ops = 'op "is_true" or "is_false"';
    else if (f.kind === "enum") ops = `op "is"/"is_not", value ∈ ${JSON.stringify(f.options)}`;
    else if (f.source === "event_types") ops = `op "is"/"is_not", value ∈ ${JSON.stringify(typeNames)}`;
    else if (f.source === "journey_types") ops = `op "is"/"is_not", value ∈ ${JSON.stringify(journeyNames)}`;
    else if (f.source === "statuses") ops = `op "is"/"is_not", value ∈ ${JSON.stringify(statusNames)}`;
    else if (f.source === "venues") ops = 'op "is"/"is_not", value = exact venue name';
    return `- "${f.field}" (${f.label})${f.help ? ` — ${f.help}` : ""}: ${ops}`;
  }).join("\n");

  const system = `You configure internal STAFF task automations for a DJ/event company's operations system (replacing their Notion). A rule watches events and creates a to-do task for staff when its timing + conditions match.

Convert the user's request into ONE rule as a strict JSON object. Timing has two modes:
- A date anchor + offset: task is created when (anchor date + offset_days) = today. anchor ∈ ${JSON.stringify(TRIGGER_ANCHORS.map((a) => a.value))}. offset_days is negative for "before" (e.g. "4 days before the event" → anchor "event_date", offset_days -4).
- Standing check: anchor "none" creates a task for every upcoming event that matches the conditions (use for "make sure X is done" checks). Set horizon_days to how far ahead to look (default 60).

CONDITIONS (array; join with condition_logic "all" or "any"; empty array = no conditions):
${fieldDocs}

ASSIGNEE (assignee_type ∈ ${JSON.stringify(ASSIGNEE_TYPES.map((a) => a.value))}):
- "staff" → also set assignee_employee_id to one of these ids: ${staffList.join("; ") || "(none)"}
- "department" → also set assignee_department ∈ ${JSON.stringify(DEPARTMENTS)}
- "event_poc"/"event_salesperson"/"event_dj" → the person in that role on the event
- "unassigned" → nobody yet

TASK TEXT: task_title may use tokens {{event_label}}, {{client_name}}, {{event_date}}, {{event_number}}, {{dj_name}}, {{event_type}}. Write titles like the user's examples, e.g. "Request Timeline for {{event_label}}" or "Make sure Drew assigned a DJ for {{event_label}}". task_priority ∈ "low"|"normal"|"high".

DUE DATE: due_offset_days (relative to the same anchor unless due_anchor set). For "none" rules the due date defaults to the event date; a negative due_offset_days makes it due before the event.

If the request needs data the system does not track (e.g. whether an onboarding call was booked — only the "call_booked" custom flag exists and is not populated yet), still build the rule but add a "warning" string explaining the prerequisite.

Respond with ONLY this JSON (no prose, no code fences):
{"name":"...","description":"...","trigger_anchor":"...","offset_days":0,"horizon_days":null,"conditions":[{"field":"...","op":"...","value":"..."}],"condition_logic":"all","task_title":"...","task_body":null,"task_priority":"normal","assignee_type":"...","assignee_employee_id":null,"assignee_department":null,"due_offset_days":0,"due_anchor":null,"warning":null}`;

  let raw = "";
  try {
    raw = await chatComplete([{ role: "system", content: system }, { role: "user", content: ask }]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed" }, { status: 502 });
  }

  const json = raw.replace(/```json|```/g, "").trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(start >= 0 ? json.slice(start, end + 1) : json);
  } catch {
    return NextResponse.json({ error: "Could not parse AI response.", raw }, { status: 502 });
  }

  return NextResponse.json({ draft: parsed });
}
