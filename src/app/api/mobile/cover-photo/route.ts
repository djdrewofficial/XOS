import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/* Mobile-app event cover photo. The couple uploads a header photo from the
   Xpress app; they authenticate with their Supabase access token (Bearer). We
   verify access to the event through RLS (an anon client carrying their JWT can
   only read events they're attached to), then upload + set the cover via the
   admin client (clients can't write `events` directly under RLS). */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS-authenticated client (same row visibility as the app's own session).
  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: userData, error: userError } = await rls.auth.getUser(token);
  if (userError || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const eventId = (form?.get("eventId") ?? "").toString();
  const file = form?.get("photo") as File | null;
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

  // Access check: RLS only returns the event if this login is attached to it.
  const { data: ev } = await rls.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!ev) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // No file => remove the cover photo.
  if (!file || file.size === 0) {
    await admin.from("events").update({ cover_photo_url: null }).eq("id", eventId);
    return NextResponse.json({ ok: true, url: null });
  }
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Image too large (max 12MB)" }, { status: 413 });

  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("event-photos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const url = admin.storage.from("event-photos").getPublicUrl(path).data.publicUrl;
  const { error } = await admin.from("events").update({ cover_photo_url: url }).eq("id", eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, url });
}
