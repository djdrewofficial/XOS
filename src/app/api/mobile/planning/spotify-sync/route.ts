import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";
import { reconcileSection, type SyncSectionRow } from "@/lib/spotifySync";

/* Mobile Spotify live-sync enable/disable for a song section. JWT-verified;
   staff + hosts only. Mirrors the portal enablePlaylistSync / disablePlaylistSync
   server actions. */
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
  const sectionId = String(body?.sectionId ?? "");
  if (!eventId || !sectionId || !action) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const { data: acct } = await rls.from("accounts").select("account_type").eq("auth_user_id", uid).maybeSingle();
  const accountType = (acct?.account_type as "staff" | "client" | "event_guest" | undefined) ?? "staff";
  const role = await resolveEventRole(rls, uid, accountType, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  if (action === "enable") {
    const playlistId = String(body?.playlistId ?? "");
    const playlistName = String(body?.playlistName ?? "Spotify playlist");
    if (!playlistId) return NextResponse.json({ error: "playlistId required" }, { status: 400 });
    const { error } = await admin
      .from("planning_sections")
      .update({ spotify_sync_playlist_id: playlistId, spotify_sync_playlist_name: playlistName, spotify_sync_user_id: uid })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: section } = await admin
      .from("planning_sections")
      .select("id, event_id, song_limit, spotify_sync_playlist_id, spotify_sync_user_id")
      .eq("id", sectionId)
      .maybeSingle();
    const result = section ? await reconcileSection(admin, section as SyncSectionRow) : { added: 0, removed: 0 };
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "disable") {
    await admin
      .from("planning_sections")
      .update({ spotify_sync_playlist_id: null, spotify_sync_playlist_name: null, spotify_sync_user_id: null, spotify_synced_at: null })
      .eq("id", sectionId)
      .eq("event_id", eventId);
    await admin.from("planning_songs").update({ synced: false }).eq("section_id", sectionId).eq("synced", true);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
