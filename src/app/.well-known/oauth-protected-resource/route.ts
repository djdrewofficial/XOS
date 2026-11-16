import { buildProtectedResourceMetadata, mcpResourceUrl } from "@/lib/mcp/oauth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 9728 root protected-resource metadata for the MCP connector. */
export function GET() {
  return Response.json(buildProtectedResourceMetadata(mcpResourceUrl()), {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "application/json",
    },
  });
}
