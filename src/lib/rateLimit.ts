import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/* Persistent (DB-backed) rate limiter — XOS runs on serverless functions, so
   in-memory counters don't survive across invocations/instances. Each throttled
   action records a row in rate_limit_hits under a (bucket, key) pair; a limiter
   counts recent rows in a sliding window. `admin` must be the service-role
   client (the table is locked to service-role by RLS). */

/** True when (bucket, key) has already reached `max` hits within `windowMs`. */
export async function isRateLimited(
  admin: SupabaseClient,
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("key", key)
    .gt("created_at", since);
  return (count ?? 0) >= max;
}

/** Record one hit, then opportunistically drop this key's rows older than the
    window so the table self-prunes (each key stays bounded to ~max rows). */
export async function recordRateHit(
  admin: SupabaseClient,
  bucket: string,
  key: string,
  windowMs: number,
): Promise<void> {
  await admin.from("rate_limit_hits").insert({ bucket, key });
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  await admin.from("rate_limit_hits").delete().eq("bucket", bucket).eq("key", key).lt("created_at", cutoff);
}

/** Best-effort real client IP behind Cloudflare / Netlify (null if unknown). */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const nf = h.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip")?.trim() || null;
}
