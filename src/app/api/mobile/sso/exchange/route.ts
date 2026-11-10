import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMobileMe } from "@/lib/auth";
import { permCacheSecret } from "@/lib/permSnapshot";
import { clientIp, isRateLimited, recordRateHit } from "@/lib/rateLimit";
import { MOBILE_SSO_CODE_TTL_SEC, readMobileSsoCode } from "@/lib/mobileSso";

/* Second half of "Sign in with XOS" for the XOS Staff app (see
   src/lib/mobileSso.ts and /sso/mobile). Body: { code, code_verifier }.
   Returns a fresh Supabase session for the app: { access_token, refresh_token }.

   The web sign-in already passed the full staff 2FA decision before the code
   was issued, so `verified: true` tells the app not to ask for a second code
   on this new session. No JWT here: the person isn't signed in to the app yet.

   The magic-link token is created and consumed on the server, exactly like the
   passkey sign-in. It is never returned, logged, or emailed. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const MAX_PER_IP_PER_HOUR = 30;
const GENERIC = "That sign-in didn't finish. Try again.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 4000) return json({ error: GENERIC }, 400);
  let body: { code?: unknown; code_verifier?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: GENERIC }, 400);
  }

  const admin = createAdminClient();
  const ip = clientIp(req);
  if (ip) {
    if (await isRateLimited(admin, "mobilesso:ip", ip, MAX_PER_IP_PER_HOUR, HOUR)) {
      return json({ error: "Too many sign-in attempts. Wait a bit and try again." }, 429);
    }
    await recordRateHit(admin, "mobilesso:ip", ip, HOUR);
  }

  const claims = await readMobileSsoCode(
    typeof body.code === "string" ? body.code : null,
    typeof body.code_verifier === "string" ? body.code_verifier : null,
    permCacheSecret(),
  );
  if (!claims) return json({ error: GENERIC }, 400);

  // One use per code. The window only has to outlive the code itself.
  const burnWindow = (MOBILE_SSO_CODE_TTL_SEC + 60) * 1000;
  if (await isRateLimited(admin, "mobilesso:code", claims.jti, 1, burnWindow)) return json({ error: GENERIC }, 400);
  await recordRateHit(admin, "mobilesso:code", claims.jti, burnWindow);

  const { data: account, error: userErr } = await admin.auth.admin.getUserById(claims.uid);
  const email = account?.user?.email;
  if (userErr || !email) return json({ error: GENERIC }, 400);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token ?? "";
  if (linkErr || !tokenHash) return json({ error: GENERIC }, 500);

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  const session = verified?.session;
  if (verifyErr || !session || verified.user?.id !== claims.uid) return json({ error: GENERIC }, 500);

  // Still a staff login right now (not just when the code was issued).
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const me = await getMobileMe(asUser, session.access_token);
  if (!me || me.accountType !== "staff") {
    await admin.auth.admin.signOut(session.access_token, "local").catch(() => undefined);
    return json({ error: "That account isn't an XOS staff login." }, 403);
  }

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    verified: true,
  });
}
