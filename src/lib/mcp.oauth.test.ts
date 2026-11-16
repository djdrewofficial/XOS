import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateServiceToken } from "./mcp/crypto.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  DEFAULT_MCP_RESOURCE_URL,
  mcpWwwAuthenticateHeader,
} from "./mcp/oauth/config.ts";
import { s256Challenge, verifyPkceS256 } from "./mcp/oauth/pkce.ts";
import {
  approveConsent,
  beginAuthorize,
  handleTokenRequest,
  registerClient,
} from "./mcp/oauth/server.ts";
import { memoryOAuthStore } from "./mcp/oauth/store.ts";
import { handleMcp } from "./mcp/protocol.ts";
import { memoryStore } from "./mcp/store.ts";
import type { LiveTool } from "./mcp/protocol.ts";
import type { ServiceTokenRow } from "./mcp/auth.ts";
import { hashToken } from "./mcp/crypto.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const RESOURCE = DEFAULT_MCP_RESOURCE_URL;
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

describe("mcp oauth metadata", () => {
  it("publishes protected resource and authorization server metadata", () => {
    const prm = buildProtectedResourceMetadata(RESOURCE);
    assert.equal(prm.resource, RESOURCE);
    assert.deepEqual(prm.authorization_servers, ["https://xos-xpressdjs.netlify.app"]);
    assert.ok(prm.scopes_supported.includes("read.events"));
    assert.ok(prm.scopes_supported.includes("money"));

    const as = buildAuthorizationServerMetadata("https://xos-xpressdjs.netlify.app");
    assert.equal(as.issuer, "https://xos-xpressdjs.netlify.app");
    assert.equal(as.authorization_endpoint, "https://xos-xpressdjs.netlify.app/api/mcp/oauth/authorize");
    assert.equal(as.token_endpoint, "https://xos-xpressdjs.netlify.app/api/mcp/oauth/token");
    assert.equal(as.registration_endpoint, "https://xos-xpressdjs.netlify.app/api/mcp/oauth/register");
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
    assert.ok(as.grant_types_supported.includes("authorization_code"));
    assert.ok(as.grant_types_supported.includes("refresh_token"));

    assert.match(mcpWwwAuthenticateHeader(RESOURCE), /resource_metadata=/);
    assert.match(mcpWwwAuthenticateHeader(RESOURCE), /oauth-protected-resource\/api\/mcp/);
  });

  it("wires well-known App Router routes and Netlify CORS headers", () => {
    assert.match(read("src/app/.well-known/oauth-protected-resource/route.ts"), /buildProtectedResourceMetadata/);
    assert.match(read("src/app/.well-known/oauth-protected-resource/api/mcp/route.ts"), /buildProtectedResourceMetadata/);
    assert.match(read("src/app/.well-known/oauth-authorization-server/route.ts"), /buildAuthorizationServerMetadata/);
    assert.match(read("netlify.toml"), /\/\.well-known\/\*/);
    assert.match(read("netlify.toml"), /Access-Control-Allow-Origin/);
    assert.match(read("src/middleware.ts"), /pathname\.startsWith\("\/api\/mcp\/oauth\/"\)/);
    assert.match(read("src/app/api/mcp/route.ts"), /WWW-Authenticate/);
    assert.match(read("supabase/migrations/00235_mcp_oauth.sql"), /mcp_oauth_clients/);
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
      assert.ok(String(ok.value.client_id).startsWith("xos_oauth_"));
    }

    const bad = await registerClient(store, {
      client_name: "Bad",
      redirect_uris: ["javascript:alert(1)"],
    });
    assert.equal(bad.ok, false);

    const missing = await registerClient(store, { redirect_uris: [] });
    assert.equal(missing.ok, false);
  });
});

describe("mcp oauth PKCE and codes", () => {
  it("rejects a wrong code_verifier (PKCE failure)", async () => {
    const { store, clientId } = await registeredClient();
    const v = verifier();
    const started = await beginAuthorize(store, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: "read.events",
      state: "xyz",
      code_challenge: s256Challenge(v),
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const approved = await approveConsent(store, {
      pendingId: started.value.pendingId,
      connectionName: "Staff Grok",
      scopes: ["read.events"],
      approvedBy: "user-1",
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const code = new URL(approved.value.redirectTo).searchParams.get("code");
    assert.ok(code);

    const token = await handleTokenRequest(store, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier(), // wrong
      refresh_token: null,
      client_id: clientId,
      client_secret: null,
      resource: RESOURCE,
      basicClientId: null,
      basicClientSecret: null,
    }, new Date("2026-11-16T12:01:00Z"));
    assert.equal(token.ok, false);
    if (!token.ok) assert.match(token.body.error_description || "", /PKCE/i);
  });

  it("rejects authorization code reuse and revokes the grant", async () => {
    const { store, clientId } = await registeredClient();
    const v = verifier();
    const started = await beginAuthorize(store, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: null,
      state: null,
      code_challenge: s256Challenge(v),
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    assert.ok(started.ok);
    if (!started.ok) return;
    const approved = await approveConsent(store, {
      pendingId: started.value.pendingId,
      connectionName: "Reuse Test",
      scopes: ["read.events", "read.clients"],
      approvedBy: "user-1",
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.ok(approved.ok);
    if (!approved.ok) return;
    const code = new URL(approved.value.redirectTo).searchParams.get("code")!;
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
    }, new Date("2026-11-16T12:01:00Z"));
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
    }, new Date("2026-11-16T12:02:00Z"));
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.body.error_description || "", /already used/i);

    const grant = await store.findGrant(approved.value.grantTokenId);
    assert.ok(grant?.revoked_at);
  });
});

describe("mcp oauth refresh rotation and revocation", () => {
  it("rotates refresh tokens and rejects the old one (reuse revokes grant)", async () => {
    const mem = memoryOAuthStore();
    const { store, clientId } = await registeredClient(mem.store);
    const v = verifier();
    const started = await beginAuthorize(store, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: null,
      state: null,
      code_challenge: s256Challenge(v),
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    assert.ok(started.ok);
    if (!started.ok) return;
    const approved = await approveConsent(store, {
      pendingId: started.value.pendingId,
      connectionName: "Refresh Bot",
      scopes: ["read.events"],
      approvedBy: "user-1",
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.ok(approved.ok);
    if (!approved.ok) return;
    const code = new URL(approved.value.redirectTo).searchParams.get("code")!;
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
    }, new Date("2026-11-16T12:01:00Z"));
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
    }, new Date("2026-11-16T12:02:00Z"));
    assert.equal(rotated.ok, true);
    if (!rotated.ok) return;
    assert.notEqual(rotated.value.refresh_token, issued.value.refresh_token);
    assert.notEqual(rotated.value.access_token, issued.value.access_token);

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
    }, new Date("2026-11-16T12:03:00Z"));
    assert.equal(reuse.ok, false);
    const grant = await store.findGrant(approved.value.grantTokenId);
    assert.ok(grant?.revoked_at);
  });

  it("rejects MCP calls after the OAuth grant is revoked", async () => {
    const oauth = memoryOAuthStore();
    const { store, clientId } = await registeredClient(oauth.store);
    const v = verifier();
    const started = await beginAuthorize(store, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: null,
      state: null,
      code_challenge: s256Challenge(v),
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    assert.ok(started.ok);
    if (!started.ok) return;
    const approved = await approveConsent(store, {
      pendingId: started.value.pendingId,
      connectionName: "Revoke Me",
      scopes: ["read.events"],
      approvedBy: "user-1",
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.ok(approved.ok);
    if (!approved.ok) return;
    const code = new URL(approved.value.redirectTo).searchParams.get("code")!;
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
    }, new Date("2026-11-16T12:01:00Z"));
    assert.ok(issued.ok);
    if (!issued.ok) return;

    const mcp = memoryStore();
    const grant = await store.findGrant(approved.value.grantTokenId);
    assert.ok(grant);
    mcp.addToken(grant);

    // Wire OAuth access token lookup into the MCP memory store.
    const accessRow = oauth.access.find((a) => a.token_hash === hashToken(issued.value.access_token));
    assert.ok(accessRow);
    mcp.store.authenticateBearer = async (raw, now) => {
      const access = oauth.access.find((a) => a.token_hash === hashToken(raw));
      if (!access) return { ok: false, reason: "invalid" };
      if (access.revoked_at) return { ok: false, reason: "revoked" };
      if (Date.parse(access.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
      const g = await store.findGrant(access.grant_token_id);
      if (!g || g.revoked_at) return { ok: false, reason: "revoked" };
      return { ok: true, token: g };
    };

    const readTool: LiveTool = {
      name: "events_list",
      description: "List events for oauth scope tests",
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

    await store.revokeGrant(approved.value.grantTokenId, new Date("2026-11-16T12:03:00Z"));

    const after = await handleMcp(mcp.store, [readTool], {
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "events_list", arguments: {} } },
      authorization: `Bearer ${issued.value.access_token}`,
      now: new Date("2026-11-16T12:04:00Z"),
    });
    assert.equal(after.status, 401);
    assert.match(JSON.stringify(after.body), /revoked|Invalid/i);
  });
});

describe("mcp oauth scopes and service tokens", () => {
  it("enforces scopes on an OAuth grant the same way as service tokens", async () => {
    const oauth = memoryOAuthStore();
    const { store, clientId } = await registeredClient(oauth.store);
    const v = verifier();
    const started = await beginAuthorize(store, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: null,
      state: null,
      code_challenge: s256Challenge(v),
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    assert.ok(started.ok);
    if (!started.ok) return;
    const approved = await approveConsent(store, {
      pendingId: started.value.pendingId,
      connectionName: "Read Only",
      scopes: ["read.events"],
      approvedBy: "user-1",
      now: new Date("2026-11-16T12:00:00Z"),
    });
    assert.ok(approved.ok);
    if (!approved.ok) return;
    const code = new URL(approved.value.redirectTo).searchParams.get("code")!;
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
    }, new Date("2026-11-16T12:01:00Z"));
    assert.ok(issued.ok);
    if (!issued.ok) return;

    const mcp = memoryStore();
    const grant = await store.findGrant(approved.value.grantTokenId);
    assert.ok(grant);
    mcp.store.authenticateBearer = async (raw) => {
      const access = oauth.access.find((a) => a.token_hash === hashToken(raw));
      if (!access) return { ok: false, reason: "invalid" };
      const g = await store.findGrant(access.grant_token_id);
      if (!g || g.revoked_at) return { ok: false, reason: "revoked" };
      return { ok: true, token: g };
    };

    const deleteTool: LiveTool = {
      name: "events_delete",
      description: "Delete an event permanently from the books",
      scopes: ["delete"],
      confirm: true,
      inputSchema: { type: "object", additionalProperties: false, properties: { event_id: { type: "string" } }, required: ["event_id"] },
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
      description: "List events for service token smoke test",
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

  it("verifies S256 PKCE helpers", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(v, "utf8").digest("base64url");
    assert.equal(s256Challenge(v), challenge);
    assert.equal(verifyPkceS256(v, challenge), true);
    assert.equal(verifyPkceS256("wrong-verifier-value-that-is-long-enough-xx", challenge), false);
  });
});
