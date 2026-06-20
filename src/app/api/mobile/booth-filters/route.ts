import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { boothFilters } from "@/lib/templatesbooth";

/* Mobile photo-booth filter values proxy (valid layout/image_type/no_of_images/
   type/tag options for the picker). JWT-verified, key injected server-side.
   Mirrors /api/mobile/booth-templates. */
export async function GET(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await boothFilters();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
