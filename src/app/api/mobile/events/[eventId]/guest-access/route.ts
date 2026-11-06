import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { resolveEventRole } from "@/lib/planning";
import { isUuid, lookupMobileAccountKind } from "@/lib/mobileCouple";

/* Hosts and staff choose which planning sections guests can see and fill out.
   GET → { sections: [{ id, title, guestEnabled }] }
   PUT { sectionId, guestEnabled } → { ok, sectionId, guestEnabled }
   Guests are rejected. A guest JWT also cannot update planning_sections.guest_enabled
   under RLS (the column trigger only lets them change client_notes). */

async function callerRole(req: Request, eventId: string, need: "view" | "edit") {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await rls.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const accountType = await lookupMobileAccountKind(rls, data.user.id);
  if (!accountType) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  const role = await resolveEventRole(rls, data.user.id, accountType, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  if (role === "staff") {
    const denied = await requireMobileStaffModule(rls, token, "events", need);
    if (denied) return denied;
  }
  return { role };
}

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const who = await callerRole(req, eventId, "view");
  if (who instanceof NextResponse) return who;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("planning_sections")
    .select("id, title, guest_enabled, sort_order")
    .eq("event_id", eventId)
    .is("deleted_by_host_at", null)
    .order("sort_order");
  if (error) return NextResponse.json({ error: "Could not load sections." }, { status: 500 });
  return NextResponse.json({
    sections: (data ?? []).map((row) => ({
      id: row.id as string,
      title: (row.title as string) ?? "",
      guestEnabled: Boolean(row.guest_enabled),
    })),
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const who = await callerRole(req, eventId, "edit");
  if (who instanceof NextResponse) return who;
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId.trim() : "";
  if (!isUuid(sectionId) || typeof body?.guestEnabled !== "boolean") {
    return NextResponse.json({ error: "sectionId and guestEnabled are required." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("planning_sections")
    .update({ guest_enabled: body.guestEnabled })
    .eq("id", sectionId)
    .eq("event_id", eventId)
    .select("id, guest_enabled")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update that section." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That section was not found." }, { status: 404 });
  return NextResponse.json({ ok: true, sectionId: data.id, guestEnabled: Boolean(data.guest_enabled) });
}
