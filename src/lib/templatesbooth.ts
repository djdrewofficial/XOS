/* TemplatesBooth API (https://templatesbooth.com/wp-json/tb/v1) — read-only
   photo-booth designs. Server-only: the premium API key (TEMPLATESBOOTH_API_KEY)
   is injected here and NEVER reaches the client. Both the mobile proxy routes
   (/api/mobile/booth-*) and the portal server actions call through this. */
import "server-only";

const BASE = "https://templatesbooth.com/wp-json/tb/v1";

// Query params we forward to /templates (everything else is dropped).
const ALLOWED = new Set([
  "page",
  "per_page",
  "layout",
  "image_type",
  "no_of_images",
  "tags",
  "tag",
  "search",
  "type",
  "text_display",
]);

export type BoothResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

/** Whitelist + clamp the inbound query before forwarding upstream. */
function buildQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const [k, v] of params) {
    if (!ALLOWED.has(k) || v === "") continue;
    if (k === "per_page") {
      const n = Math.min(200, Math.max(1, parseInt(v, 10) || 24));
      out.set("per_page", String(n));
    } else {
      out.append(k, v);
    }
  }
  return out.toString();
}

async function call(path: string, query: string): Promise<BoothResult> {
  const key = process.env.TEMPLATESBOOTH_API_KEY;
  if (!key) return { ok: false, status: 500, error: "TEMPLATESBOOTH_API_KEY is not configured" };
  try {
    const res = await fetch(`${BASE}${path}${query ? `?${query}` : ""}`, {
      headers: { "X-API-Key": key, Accept: "application/json" },
      // Designs change rarely; cache to stay well under the 240 req/min cap.
      next: { revalidate: 300 },
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : `TemplatesBooth error ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "Upstream fetch failed" };
  }
}

/** GET /templates — paginated photo-booth designs. */
export function boothTemplates(params: URLSearchParams): Promise<BoothResult> {
  return call("/templates", buildQuery(params));
}

/** GET /filters — valid filter values for building the picker UI. */
export function boothFilters(): Promise<BoothResult> {
  return call("/filters", "");
}
