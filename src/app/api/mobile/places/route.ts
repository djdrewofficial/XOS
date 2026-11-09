import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";
import { placesResponse } from "@/lib/places";

/* Bearer-JWT twin of /api/places for XOS Mobile (no cookies). Same Google
   Places (New) proxy on the server-only GOOGLE_MAPS_API_KEY, same per-IP rate
   limit bucket, identical response JSON:
     GET ?q=<text>     → { suggestions: [{ placeId, primary, secondary }] }
     GET ?id=<placeId> → { place_id, name, address, city, state, zip, lat, lng }
   Staff only (events ≥ view — the screens that pick venues). /api/mobile/* is
   middleware-exempt, so this route authenticates the token itself. */

export const dynamic = "force-dynamic";

const MINUTE = 60 * 1000;
const MAX_PER_IP_PER_MIN = 60; // keep in step with /api/places

export async function GET(req: Request) {
  const KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!KEY) return NextResponse.json({ error: "not_configured", suggestions: [] });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "unauthorized", suggestions: [] }, { status: 401 });

  const admin = createAdminClient();
  const ip = clientIp(req);
  if (ip && (await isRateLimited(admin, "places:ip", ip, MAX_PER_IP_PER_MIN, MINUTE))) {
    return NextResponse.json({ error: "rate_limited", suggestions: [] }, { status: 429 });
  }
  if (ip) await recordRateHit(admin, "places:ip", ip, MINUTE);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await requireMobileStaffModule(supabase, token, "events", "view");
  if (denied) {
    const status = denied.status;
    return NextResponse.json({ error: status === 401 ? "unauthorized" : "forbidden", suggestions: [] }, { status });
  }

  const url = new URL(req.url);
  return placesResponse(KEY, url.searchParams.get("q"), url.searchParams.get("id"));
}
