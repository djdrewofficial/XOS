import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

/* Resolve a 30-second preview for a song via Apple's free iTunes Search API
   (no key, covers nearly everything). Used when a provider didn't supply a
   preview_url (Spotify killed previews for new apps). Any signed-in user. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") ?? "").trim();
  const artist = (searchParams.get("artist") ?? "").trim();
  if (!title) return NextResponse.json({ url: null });

  const { userId } = await resolveApiUser(request);
  if (!userId) return NextResponse.json({ url: null }, { status: 401 });

  // Strip noise that hurts matching ("(Official Video)", "[Remastered]", etc.).
  const clean = (s: string) => s.replace(/\s*[([].*?[)\]]\s*/g, " ").replace(/\s+/g, " ").trim();
  const term = `${clean(artist)} ${clean(title)}`.trim();

  try {
    const url = `https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(term)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ url: null });
    const json = (await res.json()) as { results?: { previewUrl?: string }[] };
    return NextResponse.json({ url: json.results?.[0]?.previewUrl ?? null });
  } catch {
    return NextResponse.json({ url: null });
  }
}
