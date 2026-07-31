import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited, recordRateHit, clientIp } from "@/lib/rateLimit";

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

// South Florida bounding box — covers the SE tri-county (Palm Beach → Miami-Dade),
// the upper Keys (Key Largo / Islamorada), and the SW Gulf coast (Naples / Fort
// Myers). low = SW corner, high = NE corner.
const SF_BOUNDS = {
  low: { latitude: 24.85, longitude: -82.0 },
  high: { latitude: 27.0, longitude: -80.0 },
};

type Suggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
  };
};
type AddressComponent = { types?: string[]; longText?: string; shortText?: string };
type PlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: AddressComponent[];
};

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

  try {
    if (id) {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: {
          "X-Goog-Api-Key": KEY,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents",
        },
      });
      if (!res.ok) return NextResponse.json({ error: "details_failed" }, { status: 502 });
      const d = (await res.json()) as PlaceDetails;
      const comp = (type: string, short = false): string | null => {
        const c = (d.addressComponents ?? []).find((x) => x.types?.includes(type));
        return c ? (short ? c.shortText ?? null : c.longText ?? null) : null;
      };
      return NextResponse.json({
        place_id: d.id ?? null,
        name: d.displayName?.text ?? "",
        address: d.formattedAddress ?? "",
        city: comp("locality") ?? comp("postal_town") ?? comp("sublocality"),
        state: comp("administrative_area_level_1", true),
        zip: comp("postal_code"),
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
      });
    }

    if (q && q.trim().length >= 3) {
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "X-Goog-Api-Key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: q,
          includedRegionCodes: ["us"],
          // restrict to South Florida (Palm Beach → Miami-Dade, coast to western
          // suburbs). Adjust SF_BOUNDS to widen (e.g. the Keys / Treasure Coast).
          locationRestriction: { rectangle: SF_BOUNDS },
        }),
      });
      if (!res.ok) return NextResponse.json({ suggestions: [] });
      const d = (await res.json()) as { suggestions?: Suggestion[] };
      const suggestions = (d.suggestions ?? [])
        .map((s) => ({
          placeId: s.placePrediction?.placeId ?? "",
          primary: s.placePrediction?.structuredFormat?.mainText?.text ?? s.placePrediction?.text?.text ?? "",
          secondary: s.placePrediction?.structuredFormat?.secondaryText?.text ?? "",
        }))
        .filter((s) => s.placeId);
      return NextResponse.json({ suggestions });
    }

    return NextResponse.json({ suggestions: [] });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
