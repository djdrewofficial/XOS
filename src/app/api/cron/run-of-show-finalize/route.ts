import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderRunOfShowPdf, saveRunOfShowToDocs, emailRunOfShowToStaff, runOfShowFilename } from "@/lib/runOfShow";

/* Internal finalize step for the run-of-show background job: takes the AI-generated
   HTML, renders the branded PDF (chromium is bundled for /api/cron/**), saves it to
   the event's Docs, optionally emails staff, and marks the job done. Called only by
   the background function with the CRON_SECRET bearer. Machine endpoint (middleware
   exempts /api/cron/*). */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { jobId, html, error, eventId, eventName, eventDate, emailStaff } = body ?? {};
  if (!jobId) return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  const admin = createAdminClient();
  const now = new Date().toISOString();

  try {
    if (error || !html || !eventId) {
      await admin.from("run_of_show_jobs").update({ status: "error", error: error || "No content generated.", updated_at: now }).eq("id", jobId);
      return NextResponse.json({ ok: false });
    }
    const name = eventName || "Event";
    const pdf = await renderRunOfShowPdf(admin, html, name, eventDate || null);
    const filename = runOfShowFilename(name);
    const fileId = await saveRunOfShowToDocs(admin, eventId, pdf, filename);
    let emailed = 0;
    if (emailStaff) emailed = await emailRunOfShowToStaff(admin, eventId, pdf, filename, name);
    await admin
      .from("run_of_show_jobs")
      .update({ status: "done", file_id: fileId, file_name: filename, emailed, updated_at: now })
      .eq("id", jobId);
    return NextResponse.json({ ok: true, emailed });
  } catch (e) {
    console.error("[run-of-show finalize] failed", e);
    await admin
      .from("run_of_show_jobs")
      .update({ status: "error", error: e instanceof Error ? e.message : "Finalize failed.", updated_at: now })
      .eq("id", jobId);
    return NextResponse.json({ ok: false, error: "finalize failed" }, { status: 500 });
  }
}
