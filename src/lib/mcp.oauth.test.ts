import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateServiceToken, hashToken } from "./mcp/crypto.ts";
import type { ServiceTokenRow } from "./mcp/auth.ts";
import {
  acceptedMcpResourceUrls,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  DEFAULT_MCP_RESOURCE_URL,
  DEFAULT_PUBLIC_ORIGIN,
  isAcceptedMcpResource,
  LEGACY_MCP_RESOURCE_URL,
  mcpIssuer,
  mcpResourceUrl,
  mcpWwwAuthenticateHeader,
} from "./mcp/oauth/config.ts";
import { s256Challenge, verifyPkceS256 } from "./mcp/oauth/pkce.ts";
import { mcpScopesForRole, oauthConnectionName } from "./mcp/oauth/roleScopes.ts";
import {
  AUTHORIZE_CSRF_COOKIE,
  AUTHORIZE_SECURITY_HEADERS,
  mintAuthorizeCsrf,
  processAuthorizeConsentDecision,
  renderAuthorizeConsentHtml,
  verifyAuthorizeCsrf,
} from "./mcp/oauth/authorizeConsent.ts";
import {
  completeAuthorize,
  handleTokenRequest,
  isAllowedOAuthRedirectUri,
  registerClient,
  resolveBearerIdentity,
  validateAuthorizeRequest,
} from "./mcp/oauth/server.ts";
import { memoryOAuthStore } from "./mcp/oauth/store.ts";
import { handleMcp, type LiveTool } from "./mcp/protocol.ts";
import { memoryStore } from "./mcp/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const RESOURCE = DEFAULT_MCP_RESOURCE_URL;
const LEGACY = LEGACY_MCP_RESOURCE_URL;
const REDIRECT = "https://agent.example/callback";

function verifier(): string {
  return randomBytes(32).toString("base64url");
}

async function registeredClient(store = memoryOAuthStore().store) {
  const reg = await registerClient(store, {
    client_name: "Test Agent",
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "none",
  });
  assert.equal(reg.ok, true);
  if (!reg.ok) throw new Error("register failed");
  return { store, clientId: String(reg.value.client_id) };
}

function authorizeQuery(clientId: string, challenge: string) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: null,
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  };
}

const staff = {
  userId: "user-drew",
  displayName: "Drew Segura",
  scopes: mcpScopesForRole("master_admin"),
};

describe("mcp oauth metadata", () => {
  it("publishes protected resource and authorization server metadata on the public origin", () => {
    assert.equal(DEFAULT_MCP_RESOURCE_URL, "https://xos.xpressdjs.com/api/mcp");
    assert.equal(mcpResourceUrl(), RESOURCE);
    assert.equal(mcpIssuer(), DEFAULT_PUBLIC_ORIGIN);

    const prm = buildProtectedResourceMetadata(RESOURCE);
    assert.equal(prm.resource, RESOURCE);
    assert.deepEqual(prm.authorization_servers, [DEFAULT_PUBLIC_ORIGIN]);
    assert.ok(prm.scopes_supported.includes("read.events"));

    const as = buildAuthorizationServerMetadata(DEFAULT_PUBLIC_ORIGIN);
    assert.equal(as.authorization_endpoint, "https://xos.xpressdjs.com/api/mcp/oauth/authorize");
    assert.equal(as.token_endpoint, "https://xos.xpressdjs.com/api/mcp/oauth/token");
    assert.equal(as.registration_endpoint, "https://xos.xpressdjs.com/api/mcp/oauth/register");
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);

    assert.match(mcpWwwAuthenticateHeader(RESOURCE), /resource_metadata=/);
    assert.match(
      mcpWwwAuthenticateHeader(RESOURCE),
      /https:\/\/xos\.xpressdjs\.com\/\.well-known\/oauth-protected-resource\/api\/mcp/,
    );
    assert.ok(isAcceptedMcpResource(RESOURCE));
    assert.ok(isAcceptedMcpResource(LEGACY));
    assert.ok(acceptedMcpResourceUrls().includes(RESOURCE));
    assert.ok(acceptedMcpResourceUrls().includes(LEGACY));
  });

  it("derives the resource URL from NEXT_PUBLIC_APP_URL when MCP overrides are unset", () => {
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    const prevMcp = process.env.MCP_RESOURCE_URL;
    const prevPublicMcp = process.env.NEXT_PUBLIC_MCP_URL;
    delete process.env.MCP_RESOURCE_URL;
    delete process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://xos.xpressdjs.com/";
    try {
      assert.equal(mcpResourceUrl(), "https://xos.xpressdjs.com/api/mcp");
      assert.equal(mcpIssuer(), "https://xos.xpressdjs.com");
    } finally {
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevApp;
      if (prevMcp === undefined) delete process.env.MCP_RESOURCE_URL;
      else process.env.MCP_RESOURCE_URL = prevMcp;
      if (prevPublicMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
      else process.env.NEXT_PUBLIC_MCP_URL = prevPublicMcp;
    }
  });

  it("wires well-known routes and authorize consent (GET never issues a code)", () => {
    assert.match(read("src/app/.well-known/oauth-protected-resource/route.ts"), /buildProtectedResourceMetadata/);
    assert.match(read("src/app/.well-known/oauth-authorization-server/route.ts"), /buildAuthorizationServerMetadata/);
    const authorizeRoute = read("src/app/api/mcp/oauth/authorize/route.ts");
    assert.match(authorizeRoute, /renderAuthorizeConsentHtml/);
    assert.match(authorizeRoute, /processAuthorizeConsentDecision/);
    assert.match(authorizeRoute, /resolveOAuthStaffUser/);
    assert.match(authorizeRoute, /mcpIssuer/);
    assert.match(authorizeRoute, /Never issue a grant or auth code on GET/);
    assert.doesNotMatch(authorizeRoute, /auto-approved/);
    // GET handler must not call completeAuthorize; only the consent POST path issues codes.
    const getFn = authorizeRoute.slice(authorizeRoute.indexOf("export async function GET"), authorizeRoute.indexOf("export async function POST"));
    assert.doesNotMatch(getFn, /completeAuthorize|processAuthorizeConsentDecision/);
    assert.match(getFn, /renderAuthorizeConsentHtml/);
    assert.throws(() => read("src/app/oauth/mcp/consent/page.tsx"), /ENOENT/);
    assert.doesNotMatch(read("supabase/migrations/00235_mcp_oauth.sql"), /mcp_oauth_settings/);
    assert.doesNotMatch(read("supabase/migrations/00235_mcp_oauth.sql"), /mcp_oauth_pending/);
    assert.match(read("netlify.toml"), /Access-Control-Allow-Origin/);
    assert.match(oauthConnectionName("Drew Segura"), /\(OAuth\)/);
    assert.match(read("docs/mcp.md"), /https:\/\/xos\.xpressdjs\.com\/api\/mcp/);
  });
});

describe("mcp oauth DCR", () => {
  it("registers a public client and rejects bad redirect URIs", async () => {
    const { store } = memoryOAuthStore();
    const ok = await registerClient(store, {
      client_name: "Grok",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.token_endpoint_auth_method, "none");
      assert.equal(ok.value.client_secret, undefined);
    }
    const bad = await registerClient(store, { client_name: "Bad", redirect_uris: ["javascript:alert(1)"] });
    assert.equal(bad.ok, false);
  });

  it("allows https and loopback http redirect URIs and rejects non-loopback http", async () => {
    assert.equal(isAllowedOAuthRedirectUri("https://agent.example/callback"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://localhost/callback"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://localhost:8787/cb"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://127.0.0.1/callback"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://127.0.0.1:3000/cb"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://[::1]/callback"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://[::1]:8080/cb"), true);
    assert.equal(isAllowedOAuthRedirectUri("http://example.com/callback"), false);
    assert.equal(isAllowedOAuthRedirectUri("http://evil.example/phish"), false);
    assert.equal(isAllowedOAuthRedirectUri("http://192.168.1.1/cb"), false);

    const { store } = memoryOAuthStore();
    for (const uri of [
      "https://cursor.com/callback",
      "http://localhost:9876/oauth",
      "http://127.0.0.1:9876/oauth",
      "http://[::1]:9876/oauth",
    ]) {
      const reg = await registerClient(store, {
        client_name: "Loopback ok",
        redirect_uris: [uri],
        token_endpoint_auth_method: "none",
      });
      assert.equal(reg.ok, true, uri);
    }
    const rejected = await registerClient(store, {
      client_name: "Remote http",
      redirect_uris: ["http://example.com/callback"],
      token_endpoint_auth_method: "none",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.body.error_description || "", /loopback/i);
  });
});

describe("mcp oauth authorize consent", () => {
  const secret = "test-mcp-oauth-csrf-secret-32b";
  const issuerOrigin = "https://xos.xpressdjs.com";

  it("GET consent HTML shows client, redirect, account, Allow/Cancel, and security headers", async () => {
    const { store, clientId } = await registeredClient();
    const challenge = s256Challenge(verifier());
    const query = authorizeQuery(clientId, challenge);
    const validated = await validateAuthorizeRequest(store, query);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    // GET path: render consent only; store must stay empty of grants/codes.
    const csrf = mintAuthorizeCsrf(staff.userId, query, new Date(), secret);
    const html = renderAuthorizeConsentHtml({
      clientName: validated.value.clientName,
      redirectUri: validated.value.redirectUri,
      accountLabel: "drew@xpressdjs.com",
      csrfToken: csrf,
      query,
    });
    assert.match(html, /Allow MCP access/);
    assert.match(html, /Test Agent/);
    assert.match(html, /agent\.example/);
    assert.match(html, /drew@xpressdjs\.com/);
    assert.match(html, /name="decision" value="allow"/);
    assert.match(html, /name="decision" value="deny"/);
    assert.match(html, /Cancel/);
    assert.match(html, /Allow/);
    assert.equal((await store.findActiveGrant(staff.userId, clientId)), null);
    assert.equal(AUTHORIZE_SECURITY_HEADERS["Cache-Control"], "no-store");
    assert.equal(AUTHORIZE_SECURITY_HEADERS["X-Frame-Options"], "DENY");
    assert.equal(AUTHORIZE_SECURITY_HEADERS["Content-Security-Policy"], "frame-ancestors 'none'");
    assert.match(read("src/app/api/mcp/oauth/authorize/route.ts"), /AUTHORIZE_SECURITY_HEADERS/);
    assert.match(read("src/app/api/mcp/oauth/authorize/route.ts"), /AUTHORIZE_CSRF_COOKIE/);
    assert.equal(AUTHORIZE_CSRF_COOKIE, "mcp_oauth_csrf");
  });

  it("POST allow with valid CSRF issues code+state and creates a grant", async () => {
    const mem = memoryOAuthStore();
    const { store, clientId } = await registeredClient(mem.store);
    const challenge = s256Challenge(verifier());
    const query = authorizeQuery(clientId, challenge);
    const csrf = mintAuthorizeCsrf(staff.userId, query, new Date(), secret);
    const result = await processAuthorizeConsentDecision({
      store,
      decision: "allow",
      formToken: csrf,
      cookieToken: csrf,
      originHeader: issuerOrigin,
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query,
      secret,
    });
    assert.equal(result.ok, true);
    if (!result.ok || result.kind !== "allow") return;
    const redirect = new URL(result.redirectTo);
    assert.ok(redirect.searchParams.get("code"));
    assert.equal(redirect.searchParams.get("state"), "xyz");
    assert.ok(await store.findActiveGrant(staff.userId, clientId));
    assert.equal(mem.codes.length, 1);
  });

  it("POST allow rejects missing/invalid CSRF or tampered params without creating a grant", async () => {
    const mem = memoryOAuthStore();
    const { store, clientId } = await registeredClient(mem.store);
    const challenge = s256Challenge(verifier());
    const query = authorizeQuery(clientId, challenge);
    const csrf = mintAuthorizeCsrf(staff.userId, query, new Date(), secret);

    const missing = await processAuthorizeConsentDecision({
      store,
      decision: "allow",
      formToken: null,
      cookieToken: csrf,
      originHeader: issuerOrigin,
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query,
      secret,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 403);

    const badCookie = await processAuthorizeConsentDecision({
      store,
      decision: "allow",
      formToken: csrf,
      cookieToken: "not-the-token",
      originHeader: issuerOrigin,
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query,
      secret,
    });
    assert.equal(badCookie.ok, false);

    const tampered = await processAuthorizeConsentDecision({
      store,
      decision: "allow",
      formToken: csrf,
      cookieToken: csrf,
      originHeader: issuerOrigin,
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query: { ...query, redirect_uri: "https://evil.example/callback" },
      secret,
    });
    assert.equal(tampered.ok, false);
    assert.equal(verifyAuthorizeCsrf({
      formToken: csrf,
      cookieToken: csrf,
      userId: "other-user",
      query,
      secret,
    }), false);

    const badOrigin = await processAuthorizeConsentDecision({
      store,
      decision: "allow",
      formToken: csrf,
      cookieToken: csrf,
      originHeader: "https://evil.example",
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query,
      secret,
    });
    assert.equal(badOrigin.ok, false);

    assert.equal((await store.findActiveGrant(staff.userId, clientId)), null);
    assert.equal(mem.codes.length, 0);
  });

  it("POST cancel redirects with access_denied and creates no grant or code", async () => {
    const mem = memoryOAuthStore();
    const { store, clientId } = await registeredClient(mem.store);
    const challenge = s256Challenge(verifier());
    const query = authorizeQuery(clientId, challenge);
    const csrf = mintAuthorizeCsrf(staff.userId, query, new Date(), secret);
    const result = await processAuthorizeConsentDecision({
      store,
      decision: "deny",
      formToken: csrf,
      cookieToken: csrf,
      originHeader: issuerOrigin,
      requestOrigin: issuerOrigin,
      userId: staff.userId,
      user: staff,
      query,
      secret,
    });
    assert.equal(result.ok, true);
    if (!result.ok || result.kind !== "deny") return;
    assert.equal(result.redirectError, "access_denied");
    assert.equal(result.state, "xyz");
    assert.equal((await store.findActiveGrant(staff.userId, clientId)), null);
    assert.equal(mem.codes.length, 0);
  });

  it("authorize route denies non-staff before any grant and keeps CSRF on the consent path", () => {
    const authorizeRoute = read("src/app/api/mcp/oauth/authorize/route.ts");
    assert.match(authorizeRoute, /access_denied/);
    assert.match(authorizeRoute, /Sign in with an XOS staff account/);
    // Non-staff is rejected before processAuthorizeConsentDecision on POST.
    const postFn = authorizeRoute.slice(authorizeRoute.indexOf("export async function POST"));
    const staffCheckIdx = postFn.indexOf("if (!staff)");
    const decisionIdx = postFn.indexOf("processAuthorizeConsentDecision");
    assert.ok(staffCheckIdx >= 0 && decisionIdx > staffCheckIdx);
  });
});

describe("mcp oauth role scopes", () => {
  it("gives master admin the full closed scope list and employees a smaller set", () => {
    const master = mcpScopesForRole("master_admin");
    assert.ok(master.includes("money"));
    assert.ok(master.includes("delete"));
    assert.ok(master.includes("comms.email"));
    const employee = mcpScopesForRole("employee");
    assert.ok(employee.includes("read.events"));
    assert.equal(employee.includes("money"), false);
    assert.equal(employee.includes("delete"), false);
  });
});

describe("mcp oauth PKCE and codes", () => {
  it("rejects a wrong code_verifier (PKCE failure)", async () => {
    const { store, clientId } = await registeredClient();
    const v = verifier();
    const done = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(v)), staff);
    assert.equal(done.ok, true);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const token = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier(),
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(token.ok, false);
    if (!token.ok) assert.match(token.body.error_description || "", /PKCE/i);
  });

  it("rejects authorization code reuse and revokes the grant", async () => {
    const { store, clientId } = await registeredClient();
    const v = verifier();
    const done = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(v)), staff);
    assert.ok(done.ok);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const first = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(first.ok, true);
    const second = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(second.ok, false);
    const grant = await store.findGrant(done.value.grantTokenId);
    assert.ok(grant?.revoked_at);
  });

  it("replaces a prior connection for the same user and client", async () => {
    const { store, clientId } = await registeredClient();
    const first = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(verifier())), staff);
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(verifier())), staff);
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.notEqual(first.value.grantTokenId, second.value.grantTokenId);
    const old = await store.findGrant(first.value.grantTokenId);
    assert.ok(old?.revoked_at);
    const active = await store.findActiveGrant(staff.userId, clientId);
    assert.equal(active?.id, second.value.grantTokenId);
    assert.match(active?.name || "", /Drew Segura \(OAuth\)/);
  });
});

describe("mcp oauth refresh rotation and revocation", () => {
  it("rotates refresh tokens and rejects the old one", async () => {
    const mem = memoryOAuthStore();
    const { store, clientId } = await registeredClient(mem.store);
    const v = verifier();
    const done = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(v)), staff);
    assert.ok(done.ok);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const issued = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const rotated = await handleTokenRequest(store, {
      grant_type: "refresh_token",
      code: null,
      redirect_uri: null,
      code_verifier: null,
      refresh_token: issued.value.refresh_token,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(rotated.ok, true);
    if (!rotated.ok) return;
    assert.notEqual(rotated.value.refresh_token, issued.value.refresh_token);

    const reuse = await handleTokenRequest(store, {
      grant_type: "refresh_token",
      code: null,
      redirect_uri: null,
      code_verifier: null,
      refresh_token: issued.value.refresh_token,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(reuse.ok, false);
    assert.ok((await store.findGrant(done.value.grantTokenId))?.revoked_at);
  });

  it("rejects MCP calls after the OAuth grant is revoked", async () => {
    const oauth = memoryOAuthStore();
    const { store, clientId } = await registeredClient(oauth.store);
    const v = verifier();
    const done = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(v)), {
      ...staff,
      scopes: ["read.events"],
    });
    assert.ok(done.ok);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const issued = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.ok(issued.ok);
    if (!issued.ok) return;

    const mcp = memoryStore();
    mcp.store.authenticateBearer = async (raw) => {
      const access = oauth.access.find((a) => a.token_hash === hashToken(raw));
      if (!access) return { ok: false, reason: "invalid" };
      if (access.revoked_at) return { ok: false, reason: "revoked" };
      const g = await store.findGrant(access.grant_token_id);
      if (!g || g.revoked_at) return { ok: false, reason: "revoked" };
      return { ok: true, token: g };
    };

    const readTool: LiveTool = {
      name: "events_list",
      description: "List events for oauth revoke tests that need a long description",
      scopes: ["read.events"],
      confirm: false,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        return { events: [] };
      },
    };

    const before = await handleMcp(mcp.store, [readTool], {
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "events_list", arguments: {} } },
      authorization: `Bearer ${issued.value.access_token}`,
      now: new Date("2026-11-16T12:02:00Z"),
    });
    assert.equal(before.status, 200);

    await store.revokeGrant(done.value.grantTokenId, new Date("2026-11-16T12:03:00Z"));
    const after = await handleMcp(mcp.store, [readTool], {
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "events_list", arguments: {} } },
      authorization: `Bearer ${issued.value.access_token}`,
      now: new Date("2026-11-16T12:04:00Z"),
    });
    assert.equal(after.status, 401);
  });
});

describe("mcp oauth scopes and service tokens", () => {
  it("enforces scopes on an OAuth grant the same way as service tokens", async () => {
    const oauth = memoryOAuthStore();
    const { store, clientId } = await registeredClient(oauth.store);
    const v = verifier();
    const done = await completeAuthorize(store, authorizeQuery(clientId, s256Challenge(v)), {
      ...staff,
      scopes: ["read.events"],
    });
    assert.ok(done.ok);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const issued = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.ok(issued.ok);
    if (!issued.ok) return;

    const mcp = memoryStore();
    mcp.store.authenticateBearer = async (raw) => {
      const access = oauth.access.find((a) => a.token_hash === hashToken(raw));
      if (!access) return { ok: false, reason: "invalid" };
      const g = await store.findGrant(access.grant_token_id);
      if (!g || g.revoked_at) return { ok: false, reason: "revoked" };
      return { ok: true, token: g };
    };

    const deleteTool: LiveTool = {
      name: "events_delete",
      description: "Delete an event permanently from the books for scope tests",
      scopes: ["delete"],
      confirm: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { event_id: { type: "string" } },
        required: ["event_id"],
      },
      async execute() {
        return { ok: true };
      },
    };

    const denied = await handleMcp(mcp.store, [deleteTool], {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "events_delete", arguments: { event_id: "e1" } },
      },
      authorization: `Bearer ${issued.value.access_token}`,
      now: new Date("2026-11-16T12:02:00Z"),
    });
    assert.equal(denied.status, 200);
    assert.match(JSON.stringify(denied.body), /scope|not allowed|missing/i);
  });

  it("keeps existing service bearer tokens working", async () => {
    const minted = generateServiceToken();
    const row: ServiceTokenRow = {
      id: "svc-1",
      name: "Mariah Agent",
      scopes: ["read.events"],
      expires_at: null,
      revoked_at: null,
      overlap_until: null,
      token_hash: minted.hash,
    };
    const { store, addToken } = memoryStore();
    addToken(row);
    const tool: LiveTool = {
      name: "events_list",
      description: "List events for service token smoke test covering oauth change",
      scopes: ["read.events"],
      confirm: false,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        return { events: [1] };
      },
    };
    const result = await handleMcp(store, [tool], {
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "events_list", arguments: {} } },
      authorization: `Bearer ${minted.raw}`,
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.equal(result.status, 200);
    assert.match(JSON.stringify(result.body), /"events"/);
  });

  it("verifies S256 PKCE helpers and authorize validation", async () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(v, "utf8").digest("base64url");
    assert.equal(s256Challenge(v), challenge);
    assert.equal(verifyPkceS256(v, challenge), true);
    const { store, clientId } = await registeredClient();
    const ok = await validateAuthorizeRequest(store, authorizeQuery(clientId, challenge));
    assert.equal(ok.ok, true);
    const legacyOk = await validateAuthorizeRequest(store, {
      ...authorizeQuery(clientId, challenge),
      resource: LEGACY,
    });
    assert.equal(legacyOk.ok, true);
    const bad = await validateAuthorizeRequest(store, {
      ...authorizeQuery(clientId, challenge),
      code_challenge_method: "plain",
    });
    assert.equal(bad.ok, false);
  });

  it("accepts a legacy netlify.app audience on token exchange and MCP bearer checks", async () => {
    const oauth = memoryOAuthStore();
    const { store, clientId } = await registeredClient(oauth.store);
    const v = verifier();
    const done = await completeAuthorize(
      store,
      { ...authorizeQuery(clientId, s256Challenge(v)), resource: LEGACY },
      { ...staff, scopes: ["read.events"] },
    );
    assert.ok(done.ok);
    if (!done.ok) return;
    const code = new URL(done.value.redirectTo).searchParams.get("code")!;
    const issued = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: v,
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: LEGACY,
      basicClientId: null,
      basicClientSecret: null,
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const access = oauth.access.find((a) => a.token_hash === hashToken(issued.value.access_token));
    assert.equal(access?.resource, LEGACY);

    const identity = await resolveBearerIdentity({
      raw: issued.value.access_token,
      findServiceTokenByHash: async () => null,
      findAccessByHash: async (hash) => oauth.access.find((a) => a.token_hash === hash) ?? null,
      findGrant: async (id) => (await store.findGrant(id)),
    });
    assert.equal(identity.ok, true);
  });
});

