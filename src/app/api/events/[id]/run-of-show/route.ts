import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiModule } from "@/lib/apiAuth";
import { generateRunOfShow, saveRunOfShowToDocs, emailRunOfShowToStaff } from "@/lib/runOfShow";

/* Generate the run-of-show PDF (staff-only, events edit), save it to the event's
   Docs, and optionally email it to the assigned staff. */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const denied = await requireApiModule("events", "edit", supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));

  const gen = await generateRunOfShow(supabase, id);
  if (!gen.ok || !gen.pdf || !gen.filename) {
    return NextResponse.json({ ok: false, error: gen.error ?? "Generation failed." }, { status: 400 });
  }

  const admin = createAdminClient();
  const fileId = await saveRunOfShowToDocs(admin, id, gen.pdf, gen.filename);
  let emailed = 0;
  if (body?.email) emailed = await emailRunOfShowToStaff(admin, id, gen.pdf, gen.filename, gen.eventName ?? "Event");

  revalidatePath(`/events/${id}`);
  return NextResponse.json({ ok: true, fileName: gen.filename, saved: !!fileId, emailed });
}
