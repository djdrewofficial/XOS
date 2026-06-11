import { createClient } from "@supabase/supabase-js";

/* Service-role client — BYPASSES Row Level Security.
   Use ONLY in trusted server-side contexts with no user session:
   the Mailgun webhook and the outbox cron route. Never import this into
   client components or expose SUPABASE_SERVICE_ROLE_KEY to the browser. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set for background jobs");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
