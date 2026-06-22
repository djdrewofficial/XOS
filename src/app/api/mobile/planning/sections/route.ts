import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";

/* Mobile section management (reorder / delete / restore). Staff + hosts only —
   guests are rejected. Hosts can't write planning_sections under RLS (staff-only
   write policy), so after verifying the caller's role we mutate via the admin
   client — mirroring the web planner's server actions. JWT-verified via the
   /api/mobile/ prefix (exempt from the origin-lock + login-wall). */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;
  const eventId = String(body?.eventId ?? "");
  if (!eventId || !action) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  // Resolve the caller's role for this event (no account row → owner/staff).
  const { data: acct } = await rls.from("accounts").select("account_type").eq("auth_user_id", uid).maybeSingle();
  const accountType = (acct?.account_type as "staff" | "client" | "event_guest" | undefined) ?? "staff";
  const role = await resolveEventRole(rls, uid, accountType, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  if (action === "reorder") {
    const ids: string[] = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
    if (!ids.length) return NextResponse.json({ error: "orderedIds required" }, { status: 400 });
    // Reorder WITHIN the set: keep the same sort_order slots, just permuted — so a
    // group's sections stay in their event-wide positions relative to other groups.
    const { data: rows } = await admin
      .from("planning_sections")
      .select("id, sort_order")
      .eq("event_id", eventId)
      .in("id", ids);
    if ((rows?.length ?? 0) !== ids.length) return NextResponse.json({ error: "Section mismatch" }, { status: 400 });
    const slots = (rows ?? []).map((r) => r.sort_order as number).sort((a, b) => a - b);
    await Promise.all(
      ids.map((id, i) => admin.from("planning_sections").update({ sort_order: slots[i] }).eq("id", id).eq("event_id", eventId)),
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const sectionId = String(body.sectionId ?? "");
    if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });
    if (role === "staff") {
      // Staff = permanent delete.
      const { error } = await admin.from("planning_sections").delete().eq("id", sectionId).eq("event_id", eventId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      // Host = soft delete (recoverable via restore).
      const { error } = await admin
        .from("planning_sections")
        .update({ deleted_by_host_at: new Date().toISOString(), deleted_by_host: uid })
        .eq("id", sectionId)
        .eq("event_id", eventId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "set_time") {
    // Couple sets/clears the time shown for a section on their timeline (time_label).
    const sectionId = String(body.sectionId ?? "");
    if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });
    const time = body.time == null ? null : String(body.time).trim() || null;
    const { error } = await admin
      .from("planning_sections")
      .update({ time_label: time })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_timeline") {
    // Couple toggles whether a section appears on THEIR client timeline view.
    // Per-event only (event's own planning_sections row) — never touches templates.
    const sectionId = String(body.sectionId ?? "");
    const on = body.on;
    if (!sectionId || typeof on !== "boolean") return NextResponse.json({ error: "sectionId and on required" }, { status: 400 });
    const { error } = await admin
      .from("planning_sections")
      .update({ on_timeline: on })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "restore") {
    const sectionId = String(body.sectionId ?? "");
    if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });
    const { error } = await admin
      .from("planning_sections")
      .update({ deleted_by_host_at: null, deleted_by_host: null })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
