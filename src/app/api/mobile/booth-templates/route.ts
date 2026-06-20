import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { boothTemplates } from "@/lib/templatesbooth";

/* Mobile photo-booth design proxy. The couple's app calls this with their
   Supabase access token (Bearer); we verify it, then forward the query to the
   TemplatesBooth API with the server-side X-API-Key. The key never leaves XOS.
   Exempt from the origin-lock + login-wall via the /api/mobile/ prefix. */
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

  const res = await boothTemplates(new URL(req.url).searchParams);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
