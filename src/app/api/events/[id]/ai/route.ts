import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiModule } from "@/lib/apiAuth";
import { summarizeEvent, answerEventQuestion } from "@/lib/eventAI";

/* Event AI: staff-only. mode "summary" writes a briefing; mode "ask" answers a
   question grounded in the event's planner/staff/package/Fireflies/notes data. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const denied = await requireApiModule("events", "view", supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "ask" ? "ask" : "summary";

  if (mode === "ask") {
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return NextResponse.json({ ok: false, error: "Ask a question." }, { status: 400 });
    const res = await answerEventQuestion(supabase, id, question);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  const res = await summarizeEvent(supabase, id);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
