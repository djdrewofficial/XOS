import { randomBytes } from "node:crypto";
import type { ServiceTokenRow } from "../auth";
import { hashToken, hashesEqual, looksLikeServiceToken } from "../crypto";
import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_CODE_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  isAcceptedMcpResource,
  mcpResourceUrl,
} from "./config";
import { isS256Method, verifyPkceS256 } from "./pkce";
import { oauthConnectionName } from "./roleScopes";
import type { OAuthStore } from "./store";
import type {
  AuthorizeUser,
  OAuthErrorBody,
  RegisteredClientInput,
  TokenSuccess,
} from "./types";

export type OAuthResult<T> = { ok: true; value: T } | { ok: false; status: number; body: OAuthErrorBody };

function err(status: number, error: OAuthErrorBody["error"], error_description?: string): OAuthResult<never> {
  return { ok: false, status, body: { error, error_description } };
}

function ok<T>(value: T): OAuthResult<T> {
  return { ok: true, value };
}

function isoPlus(now: Date, sec: number): string {
  return new Date(now.getTime() + sec * 1000).toISOString();
}

function normalizeResource(resource: string | null | undefined, fallback = mcpResourceUrl()): string | null {
  if (resource == null || resource === "") return fallback;
  try {
    return new URL(resource).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resourcesEqual(a: string, b: string): boolean {
  try {
    return new URL(a).toString().replace(/\/$/, "") === new URL(b).toString().replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

export function generateClientId(): string {
  return `xos_oauth_${randomBytes(16).toString("base64url")}`;
}

export function generateClientSecret(): string {
  return `xos_ocs_${randomBytes(32).toString("base64url")}`;
}

export function generateOpaqueToken(prefix: string): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashToken(raw) };
}

/** RFC 7591 dynamic client registration. */
export async function registerClient(
  store: OAuthStore,
  input: RegisteredClientInput,
): Promise<OAuthResult<Record<string, unknown>>> {
  const redirectUris = (input.redirect_uris ?? []).map(String).filter(Boolean);
  if (!redirectUris.length) return err(400, "invalid_request", "redirect_uris is required");
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return err(400, "invalid_request", "redirect_uris must be http(s)");
      }
      if (parsed.hash) return err(400, "invalid_request", "redirect_uris must not include a fragment");
    } catch {
      return err(400, "invalid_request", "redirect_uris contains an invalid URI");
    }
  }

  const grantTypes = input.grant_types?.length
    ? input.grant_types.map(String)
    : ["authorization_code", "refresh_token"];
  for (const g of grantTypes) {
    if (g !== "authorization_code" && g !== "refresh_token") {
      return err(400, "invalid_request", `unsupported grant_type: ${g}`);
    }
  }
  const responseTypes = input.response_types?.length ? input.response_types.map(String) : ["code"];
  if (!responseTypes.every((r) => r === "code")) {
    return err(400, "invalid_request", "only response_type=code is supported");
  }

  const authMethod = (input.token_endpoint_auth_method ?? "none").trim() || "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod)) {
    return err(400, "invalid_request", "unsupported token_endpoint_auth_method");
  }

  const clientId = generateClientId();
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (authMethod !== "none") {
    clientSecret = generateClientSecret();
    clientSecretHash = hashToken(clientSecret);
  }

  const clientName = (input.client_name ?? "MCP client").trim().slice(0, 200) || "MCP client";
  const row = await store.insertClient({
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: authMethod as "none" | "client_secret_post" | "client_secret_basic",
  });

  const body: Record<string, unknown> = {
    client_id: row.client_id,
    client_name: row.client_name,
    redirect_uris: row.redirect_uris,
    grant_types: row.grant_types,
    response_types: row.response_types,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
  };
  if (clientSecret) body.client_secret = clientSecret;
  return ok(body);
}

export type AuthorizeQuery = {
  response_type: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  scope: string | null;
  state: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  resource: string | null;
};

/**
 * Validate authorize params and, for a signed-in staff user, immediately issue
 * an authorization code (no scope picker / no connection name). Scopes come from
 * the user's XOS role permissions. One active grant per user+client; reconnect replaces.
 */
export async function completeAuthorize(
  store: OAuthStore,
  query: AuthorizeQuery,
  user: AuthorizeUser,
  now = new Date(),
): Promise<OAuthResult<{ redirectTo: string; grantTokenId: string }>> {
  if (query.response_type !== "code") return err(400, "invalid_request", "response_type must be code");
  if (!query.client_id) return err(400, "invalid_request", "client_id is required");
  if (!query.redirect_uri) return err(400, "invalid_request", "redirect_uri is required");
  if (!query.code_challenge) return err(400, "invalid_request", "code_challenge is required");
  if (!isS256Method(query.code_challenge_method)) {
    return err(400, "invalid_request", "code_challenge_method must be S256");
  }

  const client = await store.findClient(query.client_id);
  if (!client) return err(400, "invalid_client", "Unknown client_id");
  if (!client.redirect_uris.includes(query.redirect_uri)) {
    return err(400, "invalid_request", "redirect_uri is not registered for this client");
  }

  const resource = normalizeResource(query.resource);
  if (!resource || !isAcceptedMcpResource(resource)) {
    return err(400, "invalid_request", "resource must be the XOS MCP URL");
  }

  if (!user.scopes.length) {
    return err(403, "access_denied", "This XOS account has no MCP permissions");
  }

  const existing = await store.findActiveGrant(user.userId, client.client_id);
  if (existing) await store.revokeGrant(existing.id, now);

  const grant = await store.insertGrant({
    name: oauthConnectionName(user.displayName),
    scopes: user.scopes,
    oauthClientId: client.client_id,
    oauthClientName: client.client_name,
    approvedBy: user.userId,
    now,
  });

  const code = generateOpaqueToken("xos_ac_");
  await store.insertAuthCode({
    code_hash: code.hash,
    client_id: client.client_id,
    redirect_uri: query.redirect_uri,
    scopes: user.scopes,
    code_challenge: query.code_challenge,
    code_challenge_method: "S256",
    resource,
    grant_token_id: grant.id,
    expires_at: isoPlus(now, AUTH_CODE_TTL_SEC),
  });

  const redirect = new URL(query.redirect_uri);
  redirect.searchParams.set("code", code.raw);
  if (query.state) redirect.searchParams.set("state", query.state);
  return ok({ redirectTo: redirect.toString(), grantTokenId: grant.id });
}

/** Validate authorize params alone (for login_required redirects before a session exists). */
export async function validateAuthorizeRequest(
  store: OAuthStore,
  query: AuthorizeQuery,
): Promise<OAuthResult<{ clientName: string; redirectUri: string }>> {
  if (query.response_type !== "code") return err(400, "invalid_request", "response_type must be code");
  if (!query.client_id) return err(400, "invalid_request", "client_id is required");
  if (!query.redirect_uri) return err(400, "invalid_request", "redirect_uri is required");
  if (!query.code_challenge) return err(400, "invalid_request", "code_challenge is required");
  if (!isS256Method(query.code_challenge_method)) {
    return err(400, "invalid_request", "code_challenge_method must be S256");
  }
  const client = await store.findClient(query.client_id);
  if (!client) return err(400, "invalid_client", "Unknown client_id");
  if (!client.redirect_uris.includes(query.redirect_uri)) {
    return err(400, "invalid_request", "redirect_uri is not registered for this client");
  }
  const resource = normalizeResource(query.resource);
  if (!resource || !isAcceptedMcpResource(resource)) {
    return err(400, "invalid_request", "resource must be the XOS MCP URL");
  }
  return ok({ clientName: client.client_name, redirectUri: query.redirect_uri });
}

async function authenticateClient(
  store: OAuthStore,
  params: {
    client_id: string | null;
    client_secret: string | null;
    basicClientId: string | null;
    basicClientSecret: string | null;
  },
): Promise<OAuthResult<NonNullable<Awaited<ReturnType<OAuthStore["findClient"]>>>>> {
  const clientId = params.basicClientId || params.client_id;
  if (!clientId) return err(401, "invalid_client", "client_id is required");
  const client = await store.findClient(clientId);
  if (!client) return err(401, "invalid_client", "Unknown client");

  const secret = params.basicClientSecret ?? params.client_secret;
  if (client.token_endpoint_auth_method === "none") {
    if (secret) return err(401, "invalid_client", "Public client must not send a client_secret");
    return ok(client);
  }
  if (!secret || !client.client_secret_hash) return err(401, "invalid_client", "client_secret is required");
  if (!hashesEqual(client.client_secret_hash, hashToken(secret))) {
    return err(401, "invalid_client", "Invalid client_secret");
  }
  return ok(client);
}

async function issueTokenPair(
  store: OAuthStore,
  args: {
    grantTokenId: string;
    clientId: string;
    scopes: string[];
    resource: string;
    now: Date;
  },
): Promise<TokenSuccess> {
  const access = generateOpaqueToken("xos_at_");
  const refresh = generateOpaqueToken("xos_rt_");
  await store.insertAccessToken({
    token_hash: access.hash,
    grant_token_id: args.grantTokenId,
    client_id: args.clientId,
    scopes: args.scopes,
    resource: args.resource,
    expires_at: isoPlus(args.now, ACCESS_TOKEN_TTL_SEC),
  });
  await store.insertRefreshToken({
    token_hash: refresh.hash,
    grant_token_id: args.grantTokenId,
    client_id: args.clientId,
    scopes: args.scopes,
    resource: args.resource,
    expires_at: isoPlus(args.now, REFRESH_TOKEN_TTL_SEC),
  });
  return {
    access_token: access.raw,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refresh.raw,
    scope: args.scopes.join(" "),
  };
}

export type TokenRequest = {
  grant_type: string | null;
  code: string | null;
  redirect_uri: string | null;
  code_verifier: string | null;
  refresh_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  resource: string | null;
  basicClientId: string | null;
  basicClientSecret: string | null;
};

export async function handleTokenRequest(
  store: OAuthStore,
  req: TokenRequest,
  now = new Date(),
): Promise<OAuthResult<TokenSuccess>> {
  const clientResult = await authenticateClient(store, req);
  if (!clientResult.ok) return clientResult;
  const client = clientResult.value;

  if (req.grant_type === "authorization_code") {
    return exchangeAuthorizationCode(store, client.client_id, req, now);
  }
  if (req.grant_type === "refresh_token") {
    return rotateRefreshToken(store, client.client_id, req, now);
  }
  return err(400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported");
}

async function exchangeAuthorizationCode(
  store: OAuthStore,
  clientId: string,
  req: TokenRequest,
  now: Date,
): Promise<OAuthResult<TokenSuccess>> {
  if (!req.code) return err(400, "invalid_request", "code is required");
  if (!req.redirect_uri) return err(400, "invalid_request", "redirect_uri is required");
  if (!req.code_verifier) return err(400, "invalid_request", "code_verifier is required");

  const codeHash = hashToken(req.code);
  const codeRow = await store.findAuthCodeByHash(codeHash);
  if (!codeRow) return err(400, "invalid_grant", "Invalid authorization code");

  if (codeRow.used_at) {
    await store.revokeGrant(codeRow.grant_token_id, now);
    return err(400, "invalid_grant", "Authorization code already used");
  }

  if (codeRow.client_id !== clientId) return err(400, "invalid_grant", "Code was not issued to this client");
  if (codeRow.redirect_uri !== req.redirect_uri) {
    return err(400, "invalid_grant", "redirect_uri does not match");
  }
  if (Date.parse(codeRow.expires_at) <= now.getTime()) {
    return err(400, "invalid_grant", "Authorization code expired");
  }

  if (!verifyPkceS256(req.code_verifier, codeRow.code_challenge)) {
    return err(400, "invalid_grant", "PKCE verification failed");
  }

  const resource = normalizeResource(req.resource, codeRow.resource);
  if (!resource || !resourcesEqual(resource, codeRow.resource)) {
    return err(400, "invalid_grant", "resource does not match the authorized audience");
  }

  const grant = await store.findGrant(codeRow.grant_token_id);
  if (!grant || grant.revoked_at) return err(400, "invalid_grant", "Grant has been revoked");

  const marked = await store.markAuthCodeUsed(codeRow.id, now);
  if (!marked) {
    await store.revokeGrant(codeRow.grant_token_id, now);
    return err(400, "invalid_grant", "Authorization code already used");
  }

  return ok(
    await issueTokenPair(store, {
      grantTokenId: grant.id,
      clientId,
      scopes: grant.scopes,
      resource: codeRow.resource,
      now,
    }),
  );
}

async function rotateRefreshToken(
  store: OAuthStore,
  clientId: string,
  req: TokenRequest,
  now: Date,
): Promise<OAuthResult<TokenSuccess>> {
  if (!req.refresh_token) return err(400, "invalid_request", "refresh_token is required");
  const hash = hashToken(req.refresh_token);
  const row = await store.findRefreshByHash(hash);
  if (!row) return err(400, "invalid_grant", "Invalid refresh token");

  if (row.revoked_at) {
    await store.revokeGrant(row.grant_token_id, now);
    return err(400, "invalid_grant", "Refresh token revoked");
  }
  if (row.client_id !== clientId) return err(400, "invalid_grant", "Refresh token client mismatch");
  if (Date.parse(row.expires_at) <= now.getTime()) {
    return err(400, "invalid_grant", "Refresh token expired");
  }

  const grant = await store.findGrant(row.grant_token_id);
  if (!grant || grant.revoked_at) return err(400, "invalid_grant", "Grant has been revoked");

  const resource = normalizeResource(req.resource, row.resource);
  if (!resource || !resourcesEqual(resource, row.resource)) {
    return err(400, "invalid_grant", "resource does not match the authorized audience");
  }

  await store.revokeAccessForGrant(grant.id, now);
  const access = generateOpaqueToken("xos_at_");
  const nextRefresh = generateOpaqueToken("xos_rt_");
  const newRefresh = await store.insertRefreshToken({
    token_hash: nextRefresh.hash,
    grant_token_id: grant.id,
    client_id: clientId,
    scopes: grant.scopes,
    resource: row.resource,
    expires_at: isoPlus(now, REFRESH_TOKEN_TTL_SEC),
  });
  await store.revokeRefresh(row.id, now, newRefresh.id);
  await store.insertAccessToken({
    token_hash: access.hash,
    grant_token_id: grant.id,
    client_id: clientId,
    scopes: grant.scopes,
    resource: row.resource,
    expires_at: isoPlus(now, ACCESS_TOKEN_TTL_SEC),
  });

  return ok({
    access_token: access.raw,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: nextRefresh.raw,
    scope: grant.scopes.join(" "),
  });
}

export function parseBasicAuth(header: string | null): { clientId: string; clientSecret: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { clientId: decoded.slice(0, idx), clientSecret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

/**
 * Resolve a bearer into a service-token-shaped identity.
 * Service tokens (xos_mcp_*) keep the existing hash lookup.
 * OAuth access tokens map to their grant row and must match the MCP audience.
 */
export async function resolveBearerIdentity(args: {
  raw: string;
  findServiceTokenByHash: (hash: string) => Promise<ServiceTokenRow | null>;
  findAccessByHash: (hash: string) => Promise<{
    token_hash: string;
    grant_token_id: string;
    scopes: string[];
    resource: string;
    expires_at: string;
    revoked_at: string | null;
  } | null>;
  findGrant: (id: string) => Promise<ServiceTokenRow | null>;
  /** Optional: recompute scopes from the connected user's live XOS role. */
  liveScopesForUser?: (userId: string) => Promise<string[] | null>;
  expectedResource?: string;
  now?: Date;
}): Promise<
  | { ok: true; token: ServiceTokenRow }
  | { ok: false; reason: "invalid" | "revoked" | "expired" | "audience" }
> {
  const now = args.now ?? new Date();

  if (looksLikeServiceToken(args.raw)) {
    const token = await args.findServiceTokenByHash(hashToken(args.raw));
    if (!token || !hashesEqual(token.token_hash, hashToken(args.raw))) return { ok: false, reason: "invalid" };
    return { ok: true, token };
  }

  const access = await args.findAccessByHash(hashToken(args.raw));
  if (!access) return { ok: false, reason: "invalid" };
  if (access.revoked_at) return { ok: false, reason: "revoked" };
  if (Date.parse(access.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
  const audienceOk = args.expectedResource
    ? resourcesEqual(access.resource, args.expectedResource)
    : isAcceptedMcpResource(access.resource);
  if (!audienceOk) return { ok: false, reason: "audience" };

  const grant = await args.findGrant(access.grant_token_id);
  if (!grant) return { ok: false, reason: "invalid" };
  if (grant.revoked_at) return { ok: false, reason: "revoked" };

  let scopes = grant.scopes;
  const approvedBy = (grant as ServiceTokenRow & { approved_by?: string | null }).approved_by;
  if (args.liveScopesForUser && approvedBy) {
    const live = await args.liveScopesForUser(approvedBy);
    if (live) scopes = live;
  }

  return { ok: true, token: { ...grant, scopes } };
}
