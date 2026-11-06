import { createSign } from "node:crypto";

/** Same bundle id as CLIENT_IOS_BUNDLE_ID in src/lib/clientApp.ts. */
const DEFAULT_CLIENT_ID = "com.xpressentertainment.client";

/* Sign in with Apple server secret and token revoke.
   The .p8 key stays in env. A bad revoke is an error string, never a throw,
   so account deletion can continue. */

const APPLE_AUD = "https://appleid.apple.com";
const TOKEN_URL = "https://appleid.apple.com/auth/token";
const REVOKE_URL = "https://appleid.apple.com/auth/revoke";

export type AppleSignInConfig = {
  keyId: string;
  privateKey: string;
  teamId: string;
  clientId: string;
};

export function appleSignInConfig(env: {
  APPLE_SIGNIN_KEY_ID?: string;
  APPLE_SIGNIN_PRIVATE_KEY?: string;
  APPLE_TEAM_ID?: string;
  APPLE_CLIENT_ID?: string;
}): AppleSignInConfig | null {
  const keyId = env.APPLE_SIGNIN_KEY_ID?.trim() ?? "";
  const teamId = env.APPLE_TEAM_ID?.trim() ?? "";
  const privateKey = normalizePem(env.APPLE_SIGNIN_PRIVATE_KEY ?? "");
  const clientId = env.APPLE_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, privateKey, teamId, clientId };
}

export function normalizePem(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n").trim();
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Short-lived client secret. Apple allows up to six months. One hour is enough to exchange and revoke. */
export function appleClientSecret(config: AppleSignInConfig, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = b64url(
    JSON.stringify({
      iss: config.teamId,
      iat: nowSec,
      exp: nowSec + 60 * 60,
      aud: APPLE_AUD,
      sub: config.clientId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${der.toString("base64url")}`;
}

export type AppleRevokeResult = { ok: true } | { ok: false; error: string };

/** Exchange the one-time authorization code, then revoke the refresh token. */
export async function revokeAppleAuthorization(opts: {
  code: string;
  env: {
    APPLE_SIGNIN_KEY_ID?: string;
    APPLE_SIGNIN_PRIVATE_KEY?: string;
    APPLE_TEAM_ID?: string;
    APPLE_CLIENT_ID?: string;
  };
  nowSec?: number;
  fetchImpl?: typeof fetch;
}): Promise<AppleRevokeResult> {
  const code = opts.code.trim();
  if (!code) return { ok: false, error: "Missing Apple authorization code." };
  const config = appleSignInConfig(opts.env);
  if (!config) return { ok: false, error: "Sign in with Apple is not configured." };

  let secret: string;
  try {
    secret = appleClientSecret(config, opts.nowSec ?? Math.floor(Date.now() / 1000));
  } catch {
    return { ok: false, error: "Could not sign the Apple client secret." };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const tokenRes = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: secret,
        code,
        grant_type: "authorization_code",
      }),
    });
    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return { ok: false, error: `Apple token exchange failed (${tokenRes.status}).` };
    }
    let parsed: { refresh_token?: string; access_token?: string } = {};
    try {
      parsed = JSON.parse(tokenText) as { refresh_token?: string; access_token?: string };
    } catch {
      return { ok: false, error: "Apple token exchange returned an unreadable body." };
    }
    const refresh = parsed.refresh_token?.trim() ?? "";
    const access = parsed.access_token?.trim() ?? "";
    const token = refresh || access;
    if (!token) return { ok: false, error: "Apple token exchange did not return a token." };

    const revokeRes = await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: secret,
        token,
        token_type_hint: refresh ? "refresh_token" : "access_token",
      }),
    });
    if (!revokeRes.ok) {
      return { ok: false, error: `Apple token revoke failed (${revokeRes.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Apple token revoke could not be reached." };
  }
}
