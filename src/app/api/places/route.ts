import { NextResponse } from "next/server";

/* PUBLIC (middleware-exempt) Google Places proxy — keeps GOOGLE_MAPS_API_KEY
   server-side so the public /proposal page can offer venue search without
   exposing the key. Uses the Places API (New) REST endpoints.
     GET ?q=<text>     → { suggestions: [{ placeId, primary, secondary }] }
     GET ?id=<placeId> → { name, address, city, state, zip, lat, lng, place_id } */

export const dynamic = "force-dynamic";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

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
        body: JSON.stringify({ input: q, includedRegionCodes: ["us"] }),
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
