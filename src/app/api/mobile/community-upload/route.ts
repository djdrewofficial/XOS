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

  // The community bucket is PUBLIC and served inline, so only allow image types —
  // otherwise a client could upload text/html or SVG that renders as active
  // content from the storage origin. The stored content-type is forced, not trusted.
  const IMAGE_TYPES: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
  };
  const contentType = IMAGE_TYPES[file.type] ? file.type : null;
  if (!contentType) {
    return NextResponse.json({ error: "Only image uploads are allowed (JPG, PNG, WEBP, GIF, HEIC)." }, { status: 415 });
  }

  const admin = createAdminClient();
  const ext = IMAGE_TYPES[contentType];
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("community")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const url = admin.storage.from("community").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, url, path });
}
