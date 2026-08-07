import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/signing";

/* Short links → tidy xos.xpressdjs.com/p/<code> URLs that redirect to a longer
   app path (e.g. a proposal at /proposal/<pay_token>). Server-only; uses the
   service-role admin client. */

// Unambiguous alphabet (no 0/O/1/l/I). 8 chars ≈ 3e14 combinations.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

function genCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Get-or-create a short link for (event, kind). Idempotent: reuses the existing
    code for that event+kind (repointing its target if it changed). Returns the
    full short URL. */
export async function getOrCreateShortLink(
  admin: SupabaseClient,
  opts: { eventId: string; kind: string; targetPath: string },
): Promise<string> {
  const { data: existing } = await admin
    .from("short_links")
    .select("code, target_path")
    .eq("event_id", opts.eventId)
    .eq("kind", opts.kind)
    .maybeSingle();

  if (existing?.code) {
    if (existing.target_path !== opts.targetPath) {
      await admin.from("short_links").update({ target_path: opts.targetPath }).eq("code", existing.code);
    }
    return `${appUrl()}/p/${existing.code}`;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genCode();
    const { error } = await admin
      .from("short_links")
      .insert({ code, target_path: opts.targetPath, kind: opts.kind, event_id: opts.eventId });
    if (!error) return `${appUrl()}/p/${code}`;
    // 23505 on (event_id, kind) → someone minted concurrently; fetch and return it.
    if (error.code === "23505") {
      const { data: race } = await admin
        .from("short_links")
        .select("code")
        .eq("event_id", opts.eventId)
        .eq("kind", opts.kind)
        .maybeSingle();
      if (race?.code) return `${appUrl()}/p/${race.code}`;
      // else it was a code collision — loop and try a new code
    }
  }
  throw new Error("Could not generate a short link — please try again.");
}
