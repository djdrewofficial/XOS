import { MCP_SCOPES } from "../scopes";

/** Canonical MCP resource URL agents connect to (Netlify origin, not Cloudflare). */
export const DEFAULT_MCP_RESOURCE_URL = "https://xos-xpressdjs.netlify.app/api/mcp";

export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 90; // 90 days
export const AUTH_CODE_TTL_SEC = 10 * 60;

export function mcpResourceUrl(): string {
  const fromEnv = process.env.MCP_RESOURCE_URL?.trim() || process.env.NEXT_PUBLIC_MCP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).toString().replace(/\/$/, "");
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_MCP_RESOURCE_URL;
}

/** Authorization server issuer (= origin of the MCP resource URL). */
export function mcpIssuer(): string {
  return new URL(mcpResourceUrl()).origin;
}

export function protectedResourceMetadataUrl(resourceUrl = mcpResourceUrl()): string {
  const url = new URL(resourceUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

export function rootProtectedResourceMetadataUrl(resourceUrl = mcpResourceUrl()): string {
  return `${new URL(resourceUrl).origin}/.well-known/oauth-protected-resource`;
}

export function authorizationServerMetadataUrl(issuer = mcpIssuer()): string {
  return `${issuer}/.well-known/oauth-authorization-server`;
}

export function authorizeEndpoint(issuer = mcpIssuer()): string {
  return `${issuer}/api/mcp/oauth/authorize`;
}

export function tokenEndpoint(issuer = mcpIssuer()): string {
  return `${issuer}/api/mcp/oauth/token`;
}

export function registrationEndpoint(issuer = mcpIssuer()): string {
  return `${issuer}/api/mcp/oauth/register`;
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function buildProtectedResourceMetadata(resourceUrl = mcpResourceUrl()) {
  const issuer = new URL(resourceUrl).origin;
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/settings/mcp`,
  };
}

/** RFC 8414 authorization server metadata. */
export function buildAuthorizationServerMetadata(issuer = mcpIssuer()) {
  return {
    issuer,
    authorization_endpoint: authorizeEndpoint(issuer),
    token_endpoint: tokenEndpoint(issuer),
    registration_endpoint: registrationEndpoint(issuer),
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  };
}

/** WWW-Authenticate challenge pointing at path-specific protected resource metadata. */
export function mcpWwwAuthenticateHeader(resourceUrl = mcpResourceUrl()): string {
  const meta = protectedResourceMetadataUrl(resourceUrl);
  return `Bearer realm="xos-mcp", resource_metadata="${meta}"`;
}
