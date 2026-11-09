/* Google Places (New) lookups behind /api/places (web + public proposal flow)
   and /api/mobile/places (XOS Mobile, Bearer JWT). Both routes return exactly
   this JSON; auth + rate limiting stay in the routes.
     ?q=<text>     → { suggestions: [{ placeId, primary, secondary }] }
     ?id=<placeId> → { place_id, name, address, city, state, zip, lat, lng } */
import "server-only";
import { NextResponse } from "next/server";

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

/** Run the lookup for ?q= / ?id= on the server key. Caller has already authed + rate-limited. */
export async function placesResponse(KEY: string, q: string | null, id: string | null): Promise<NextResponse> {
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
