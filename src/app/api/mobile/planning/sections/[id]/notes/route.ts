import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { resolveEventRole, type PlannerRole } from "@/lib/planning";
import {
  noteWriteStatus,
  notesGetBody,
  parseNotesPut,
  planningNotesAccess,
} from "@/lib/planningNotes";

/* Couple notes + staff-only notes for one planning moment.
   GET  { notes, staffNotes? }  — staffNotes is present only for staff.
   PUT  { notes?, staffNotes? } — staffNotes is 403 for anyone who is not staff.
   JWT-verified via the /api/mobile/ prefix. Writes go through the caller's own
   client so RLS (and the client_notes column guard) still apply. A login with
   no accounts row is rejected: staff is a positive account_type, matching
   xos_is_staff(), not the old "missing row means staff" fallback. */

const SECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function caller(token: string, eventId: string): Promise<
  | { role: PlannerRole | null; rls: SupabaseClient }
  | { error: NextResponse }
> {
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const rls = userClient(token);
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: acct } = await rls
    .from("accounts")
    .select("account_type")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const accountType = acct?.account_type as "staff" | "client" | "event_guest" | undefined;
  if (!accountType) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const role = await resolveEventRole(rls, userData.user.id, accountType, eventId);
  return { role, rls };
}

async function loadSection(sectionId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("planning_sections")
    .select("id, event_id, client_notes, guest_enabled")
    .eq("id", sectionId)
    .maybeSingle();
  return data as { id: string; event_id: string; client_notes: string | null; guest_enabled: boolean | null } | null;
}

async function readStaffNotes(rls: SupabaseClient, sectionId: string): Promise<string | null> {
  const { data } = await rls
    .from("planning_section_staff_notes")
    .select("body")
    .eq("section_id", sectionId)
    .maybeSingle();
  return (data?.body as string | null) ?? null;
}

function jsonError(error: { code?: string; message?: string }) {
  const status = noteWriteStatus(error) ?? 500;
  return NextResponse.json({ error: status === 403 ? "Forbidden" : error.message }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sectionId = id.trim();
  if (!SECTION_ID.test(sectionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const section = await loadSection(sectionId);
  if (!section) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = await caller(token, section.event_id);
  if ("error" in who) return who.error;
  if (planningNotesAccess(who.role, Boolean(section.guest_enabled)) !== "ok" || !who.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (who.role === "staff") {
    const denied = await requireMobileStaffModule(who.rls, token, "events", "view");
    if (denied) return denied;
  }

  const staffNotes = who.role === "staff" ? await readStaffNotes(who.rls, sectionId) : null;
  return NextResponse.json(notesGetBody(section.client_notes ?? null, staffNotes, who.role));
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sectionId = id.trim();
  if (!SECTION_ID.test(sectionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const section = await loadSection(sectionId);
  if (!section) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = await caller(token, section.event_id);
  if ("error" in who) return who.error;
  if (planningNotesAccess(who.role, Boolean(section.guest_enabled)) !== "ok" || !who.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (who.role === "staff") {
    const denied = await requireMobileStaffModule(who.rls, token, "events", "edit");
    if (denied) return denied;
  }

  const parsed = parseNotesPut(await req.json().catch(() => null), who.role);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  if (parsed.notes !== undefined) {
    const { data, error } = await who.rls
      .from("planning_sections")
      .update({ client_notes: parsed.notes })
      .eq("id", sectionId)
      .eq("event_id", section.event_id)
      .select("client_notes")
      .maybeSingle();
    if (error) return jsonError(error);
    if (!data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (parsed.staffNotes !== undefined) {
    const { error } = await who.rls.from("planning_section_staff_notes").upsert(
      { section_id: sectionId, event_id: section.event_id, body: parsed.staffNotes },
      { onConflict: "section_id" },
    );
    if (error) return jsonError(error);
  }

  const { data: fresh } = await who.rls
    .from("planning_sections")
    .select("client_notes")
    .eq("id", sectionId)
    .eq("event_id", section.event_id)
    .maybeSingle();
  const staffNotes = who.role === "staff" ? await readStaffNotes(who.rls, sectionId) : null;
  return NextResponse.json(notesGetBody((fresh?.client_notes as string | null) ?? null, staffNotes, who.role));
}
