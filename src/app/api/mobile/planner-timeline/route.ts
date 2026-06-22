import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";

/* The couple uploads their planner's official timeline (PDF or image) from the
   app. Stored in the private `event-files` bucket and recorded in `event_files`
   with source='planner_timeline' so it shows up alongside the event's other
   files for staff. GET returns the most recent one for the event. Host/staff
   only. JWT-verified via the /api/mobile/ prefix. */

const SOURCE = "planner_timeline";
const MAX = 25 * 1024 * 1024;

async function authedRole(token: string, eventId: string) {
  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return null;
  const uid = userData.user.id;
  const { data: acct } = await rls.from("accounts").select("account_type").eq("auth_user_id", uid).maybeSingle();
  const accountType = (acct?.account_type as "staff" | "client" | "event_guest" | undefined) ?? "staff";
  return resolveEventRole(rls, uid, accountType, eventId);
}

export async function GET(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!eventId) return NextResponse.json({ error: "Missing event." }, { status: 400 });

  const role = await authedRole(token, eventId);
  if (role !== "staff" && role !== "host" && role !== "guest") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("event_files")
    .select("id, name, created_at")
    .eq("event_id", eventId)
    .eq("source", SOURCE)
    .order("created_at", { ascending: false })
    .limit(1);
  return NextResponse.json({ ok: true, file: data?.[0] ?? null });
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const eventId = String(form?.get("eventId") ?? "");
  const file = form?.get("file") as File | null;
  if (!eventId) return NextResponse.json({ error: "Missing event." }, { status: 400 });
  if (!file || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 413 });

  const role = await authedRole(token, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "pdf").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "pdf";
  const path = `${eventId}/planner-timeline-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("event-files")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/pdf", upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const name = file.name || `Planner timeline.${ext}`;
  const { error: insErr } = await admin.from("event_files").insert({
    event_id: eventId,
    name,
    path,
    content_type: file.type || "application/pdf",
    size_bytes: file.size,
    source: SOURCE,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, name });
}
