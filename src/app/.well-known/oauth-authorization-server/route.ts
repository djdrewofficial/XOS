import { buildAuthorizationServerMetadata, mcpIssuer } from "@/lib/mcp/oauth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata. Issuer is the MCP Netlify origin. */
export function GET() {
  return Response.json(buildAuthorizationServerMetadata(mcpIssuer()), {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "application/json",
    },
  });
}
