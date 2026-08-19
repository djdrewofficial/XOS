import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiModule } from "@/lib/apiAuth";
import { getMe } from "@/lib/auth";
import { buildEventContext } from "@/lib/eventAI";
import { isOpenAIConfigured } from "@/lib/openai";

/* Run-of-show: START (POST) + STATUS (GET). The slow OpenAI+PDF work runs in a
   background function (15-min limit) because the sync request caps at ~26s. POST
   builds the event context, inserts a job, and triggers the background function; the
   button polls GET for status. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const denied = await requireApiModule("events", "view", supabase);
  if (denied) return denied;
  const { data: job } = await supabase
    .from("run_of_show_jobs")
    .select("id,status,file_name,emailed,error,updated_at")
    .eq("event_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ ok: true, job: job ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const denied = await requireApiModule("events", "edit", supabase);
    if (denied) return denied;
    if (!isOpenAIConfigured()) return NextResponse.json({ ok: false, error: "OpenAI isn't configured (OPENAI_API_KEY missing)." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const emailStaff = !!body?.email;
    const me = await getMe(supabase);

    const [{ data: ev }, context] = await Promise.all([
      supabase.from("events").select("name, event_date").eq("id", id).maybeSingle(),
      buildEventContext(supabase, id, { transcriptChars: 15000 }),
    ]);
    if (!context) return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
    const eventName = (ev?.name as string) || "Event";
    const eventDate = (ev?.event_date as string) || null;

    const admin = createAdminClient();
    const { data: job, error: jobErr } = await admin
      .from("run_of_show_jobs")
      .insert({ event_id: id, status: "queued", email_staff: emailStaff, requested_by: me?.employeeId ?? null })
      .select("id")
      .maybeSingle();
    if (jobErr || !job) return NextResponse.json({ ok: false, error: jobErr?.message ?? "Couldn't queue." }, { status: 500 });

    // Trigger the background function (returns 202 immediately, runs up to 15 min).
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://xos.xpressdjs.com";
    try {
      await fetch(`${base}/.netlify/functions/run-of-show-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
        body: JSON.stringify({ jobId: job.id, eventId: id, context, eventName, eventDate, emailStaff }),
      });
    } catch (e) {
      await admin.from("run_of_show_jobs").update({ status: "error", error: "Couldn't start background job." }).eq("id", job.id);
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't start generation." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    console.error("[run-of-show start] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed to start." }, { status: 500 });
  }
}
