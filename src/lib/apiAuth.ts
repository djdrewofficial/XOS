import { createClient as createAnonClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";

/* Resolve the signed-in user for an API route from EITHER a cookie session
   (the XOS web app) OR an Authorization: Bearer <supabase access token> header
   (the Xpress client mobile app, which has no cookies). Returns a Supabase
   client scoped to that user (RLS-authenticated) plus the user, or nulls. */
export async function resolveApiUser(req: Request): Promise<{
  supabase: SupabaseClient;
  userId: string | null;
}> {
  const auth = req.headers.get("authorization") ?? "";
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "");
    const supabase = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data } = await supabase.auth.getUser(token);
    return { supabase, userId: data.user?.id ?? null };
  }
  const supabase = await createCookieClient();
  const { data } = await supabase.auth.getUser();
  return { supabase: supabase as unknown as SupabaseClient, userId: data.user?.id ?? null };
}
