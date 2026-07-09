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

  if (action === "add") {
    // Couple adds a section — from a client_addable template, or a custom one
    // (name + notes + up to 3 songs). Placed at the end of the target group.
    const groupId = String(body.groupId ?? "");
    const { data: all } = await admin
      .from("planning_sections")
      .select("id, sort_order, section_type")
      .eq("event_id", eventId)
      .order("sort_order");
    const rows = (all ?? []) as { id: string; sort_order: number; section_type: string }[];
    const maxOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) : -1;

    // Insert slot = just before the next headline after the target group.
    let insertOrder: number;
    if (groupId && groupId !== "start") {
      const idx = rows.findIndex((r) => r.id === groupId);
      if (idx < 0) return NextResponse.json({ error: "Group not found" }, { status: 400 });
      const next = rows.slice(idx + 1).find((r) => r.section_type === "headline");
      insertOrder = next ? next.sort_order : maxOrder + 1;
    } else {
      const firstHeadline = rows.find((r) => r.section_type === "headline");
      insertOrder = firstHeadline ? firstHeadline.sort_order : maxOrder + 1;
    }

    // Shift sections at/after the slot down by one to make room.
    const toShift = rows.filter((r) => r.sort_order >= insertOrder);
    if (toShift.length) {
      await Promise.all(
        toShift.map((r) => admin.from("planning_sections").update({ sort_order: r.sort_order + 1 }).eq("id", r.id)),
      );
    }

    // Resolve the new section's fields — template clone vs custom.
    let title: string;
    let icon: string | null;
    let intro: string | null;
    let songLimit: number | null;
    let templateSectionId: string | null;
    const custom = body.custom as { title?: string; notes?: string; songs?: unknown[] } | undefined;

    if (body.templateSectionId) {
      templateSectionId = String(body.templateSectionId);
      const { data: ts } = await admin
        .from("planning_template_sections")
        .select("title, icon, intro, song_limit")
        .eq("id", templateSectionId)
        .eq("client_addable", true)
        .maybeSingle();
      if (!ts) return NextResponse.json({ error: "Section not available" }, { status: 400 });
      title = ts.title as string;
      icon = (ts.icon as string | null) ?? null;
      intro = (ts.intro as string | null) ?? null;
      songLimit = (ts.song_limit as number | null) ?? null;
    } else if (custom) {
      title = String(custom.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "Section name is required" }, { status: 400 });
      icon = "🎵";
      intro = String(custom.notes ?? "").trim() || null;
      songLimit = 3;
      templateSectionId = null;
    } else {
      return NextResponse.json({ error: "templateSectionId or custom required" }, { status: 400 });
    }

    const { data: ins, error: insErr } = await admin
      .from("planning_sections")
      .insert({
        event_id: eventId,
        template_section_id: templateSectionId,
        title,
        icon,
        intro,
        section_type: "timeline",
        song_limit: songLimit,
        on_timeline: true,
        sort_order: insertOrder,
      })
      .select("id")
      .single();
    if (insErr || !ins) return NextResponse.json({ error: insErr?.message ?? "Could not add section" }, { status: 500 });
    const newId = ins.id as string;

    // Clone the template section's questions (simple; conditions not carried over).
    if (templateSectionId) {
      const { data: tqs } = await admin
        .from("planning_template_questions")
        .select("prompt, help_text, answer_type, options, sort_order")
        .eq("template_section_id", templateSectionId)
        .order("sort_order");
      if (tqs?.length) {
        await admin.from("planning_questions").insert(
          tqs.map((q) => ({
            event_id: eventId,
            section_id: newId,
            prompt: q.prompt,
            help_text: q.help_text,
            answer_type: q.answer_type,
            options: q.options,
            sort_order: q.sort_order,
          })),
        );
      }
    }

    // Custom-section songs (up to 3), inserted here so the add is one atomic call.
    if (custom && Array.isArray(custom.songs) && custom.songs.length) {
      const songs = (custom.songs as Record<string, unknown>[]).slice(0, 3);
      await admin.from("planning_songs").insert(
        songs.map((s, i) => ({
          event_id: eventId,
          section_id: newId,
          title: String(s.title ?? "").slice(0, 300),
          artist: (s.artist as string | null) ?? null,
          album: (s.album as string | null) ?? null,
          artwork_url: (s.artwork_url as string | null) ?? null,
          preview_url: (s.preview_url as string | null) ?? null,
          external_url: (s.external_url as string | null) ?? null,
          provider: (s.provider as string | null) ?? "manual",
          provider_id: (s.provider_id as string | null) ?? null,
          sort_order: i,
        })),
      );
    }

    return NextResponse.json({ ok: true, sectionId: newId });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
