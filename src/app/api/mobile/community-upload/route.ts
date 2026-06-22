import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/* Community post photo upload. The couple's app posts the image (Bearer JWT);
   we verify the user, then store it in the public `community` bucket via the
   admin client and return the public URL (clients can't write storage directly). */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo") as File | null;
  if (!file || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Image too large (max 12MB)" }, { status: 413 });

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("community")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const url = admin.storage.from("community").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, url, path });
}
