import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";
import { placesResponse } from "@/lib/places";

/* PUBLIC (middleware-exempt) Google Places proxy — keeps GOOGLE_MAPS_API_KEY
   server-side so the public /proposal page can offer venue search without
   exposing the key. Uses the Places API (New) REST endpoints.
     GET ?q=<text>     → { suggestions: [{ placeId, primary, secondary }] }
     GET ?id=<placeId> → { name, address, city, state, zip, lat, lng, place_id }

   It forwards on our billed key, so it's NOT left open: every request must
   present a valid proposal token (the public /proposal flow passes it) OR a
   logged-in session (staff venue pickers), and it's per-IP rate limited either
   way so it can't be scripted to burn Places quota. */

export const dynamic = "force-dynamic";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

const MINUTE = 60 * 1000;
const MAX_PER_IP_PER_MIN = 60; // generous for 300ms-debounced typing; blocks scripts

/** A request is allowed if it carries a valid proposal token (public flow) or
    comes from a logged-in user (staff pickers). */
async function isAuthorized(admin: ReturnType<typeof createAdminClient>, token: string | null): Promise<boolean> {
  if (token) {
    const { data } = await admin.from("events").select("id").eq("pay_token", token).maybeSingle();
    if (data) return true;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user;
}

export async function GET(req: Request) {
  if (!KEY) return NextResponse.json({ error: "not_configured", suggestions: [] });

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");

  const admin = createAdminClient();
  const ip = clientIp(req);

  // Per-IP throttle first (cheap gate against scripted quota abuse).
  if (ip && (await isRateLimited(admin, "places:ip", ip, MAX_PER_IP_PER_MIN, MINUTE))) {
    return NextResponse.json({ error: "rate_limited", suggestions: [] }, { status: 429 });
  }
  if (ip) await recordRateHit(admin, "places:ip", ip, MINUTE);

  // Then require a proposal token or a session — no more open proxy.
  if (!(await isAuthorized(admin, token))) {
    return NextResponse.json({ error: "unauthorized", suggestions: [] }, { status: 401 });
  }

  return placesResponse(KEY, q, id);
}
