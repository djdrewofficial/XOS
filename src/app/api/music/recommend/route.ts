import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isOpenAIConfigured, chatComplete } from "@/lib/openai";
import { searchMusic } from "@/lib/music";

export const dynamic = "force-dynamic";

/* AI song recommendations for the Xpress Entertainment client app.
   The couple's own "About Us" + "Cultural Influence" (plus any taste answers)
   are handed to the model, which proposes songs for one moment of the night.
   Each suggestion is resolved to a real catalog track (artwork + preview) via
   the unified music search so the app can render and add it directly.

   Auth: the app's Supabase access token (Bearer), verified here — this route is
   exempted from the cookie login-wall in middleware (like /api/mobile/*). */

type ReqContext = {
  eventName?: string;
  aboutUs?: string;
  culturalInfluence?: string;
  extras?: string[];
};
type ReqBody = {
  eventId?: string;
  section?: string;
  limit?: number;
  style?: string;
  context?: ReqContext;
};
type Suggestion = { title: string; artist: string; reason?: string };

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Anon-key client carrying the user's JWT — RLS-authenticated, like the app session.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const eventId = (body.eventId ?? "").trim();
  const section = (body.section ?? "").trim() || "the event";
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 12);
  const ctx = body.context ?? {};

  if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  if (!(await userOwnsEvent(supabase, userData.user.id, eventId))) {
    return NextResponse.json({ error: "Not authorized for this event" }, { status: 403 });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: "Recommendations aren't configured yet." }, { status: 503 });
  }

  // ── Ask the model for picks grounded in the couple's own words ──
  const familiar = (body.style ?? "familiar") === "familiar";
  const facts: string[] = [];
  if (ctx.eventName) facts.push(`Event: ${ctx.eventName}`);
  if (ctx.aboutUs) facts.push(`About the couple: ${ctx.aboutUs}`);
  if (ctx.culturalInfluence) facts.push(`Cultural influence / heritage: ${ctx.culturalInfluence}`);
  for (const e of ctx.extras ?? []) if (e?.trim()) facts.push(e.trim());

  const system =
    "You are an expert wedding and event DJ and music curator for Xpress Entertainment. " +
    "Recommend songs for a specific moment of an event, tailored to the couple's story and cultural background. " +
    (familiar
      ? "Prioritize widely-recognized, high-confidence crowd-pleasers that fit the moment and their culture — avoid obscure deep cuts. "
      : "Balance crowd-pleasers with a few distinctive, personal picks that reflect their story. ") +
    "Choose songs whose energy genuinely fits the moment (e.g. an entrance is upbeat; a first dance is romantic). " +
    'Respond with ONLY a JSON object, no markdown: {"songs":[{"title","artist","reason"}]}. ' +
    "`reason` is at most 12 words explaining why it fits THIS couple. Use real, existing songs and correct artist names.";

  const user =
    `Moment: ${section}\n` +
    `Number of songs: ${limit}\n\n` +
    (facts.length
      ? `What we know about the couple:\n${facts.join("\n")}`
      : "We don't have details about the couple yet — pick broadly-loved songs for this moment.");

  let suggestions: Suggestion[];
  try {
    const raw = await chatComplete([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    suggestions = parseSuggestions(raw).slice(0, limit);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Recommendation failed." },
      { status: 502 },
    );
  }
  if (!suggestions.length) return NextResponse.json({ songs: [] });

  // ── Resolve each suggestion to a real catalog track (artwork + preview) ──
  const songs = await Promise.all(
    suggestions.map(async (s, i) => {
      const query = `${s.title} ${s.artist}`.trim();
      let track = null;
      try {
        const { results } = await searchMusic(query, { limit: 1 });
        track = results[0] ?? null;
      } catch {
        track = null;
      }
      return {
        id: track ? `${track.provider}:${track.providerId}` : `ai:${i}`,
        title: track?.title ?? s.title,
        artist: track?.artist ?? s.artist ?? null,
        artwork_url: track?.artworkUrl ?? null,
        preview_url: track?.previewUrl ?? null,
        reason: s.reason ?? null,
      };
    }),
  );

  return NextResponse.json({ songs });
}

/** Tolerant JSON parse: strips ``` fences and pulls the songs array out. */
function parseSuggestions(raw: string): Suggestion[] {
  let text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // If the model wrapped prose around the object, grab the first {...} or [...].
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const m = text.match(/[{[][\s\S]*[}\]]/);
    if (m) text = m[0];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as { songs?: unknown }).songs ?? []);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        title: typeof o.title === "string" ? o.title : "",
        artist: typeof o.artist === "string" ? o.artist : "",
        reason: typeof o.reason === "string" ? o.reason : undefined,
      };
    })
    .filter((s) => s.title.trim() !== "");
}

/** True if the signed-in account is staff, or the client/guest tied to this event. */
async function userOwnsEvent(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  const { data: account } = await supabase
    .from("accounts")
    .select("account_type, client_id, event_guest_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!account) return false;
  if (account.account_type === "staff") return true;

  if (account.client_id) {
    const [{ data: ev }, { data: link }] = await Promise.all([
      supabase.from("events").select("id").eq("id", eventId).eq("client_id", account.client_id).maybeSingle(),
      supabase.from("event_clients").select("event_id").eq("event_id", eventId).eq("client_id", account.client_id).maybeSingle(),
    ]);
    return !!ev || !!link;
  }
  if (account.event_guest_id) {
    const { data: g } = await supabase
      .from("event_guests")
      .select("event_id")
      .eq("id", account.event_guest_id)
      .eq("event_id", eventId)
      .maybeSingle();
    return !!g;
  }
  return false;
}
