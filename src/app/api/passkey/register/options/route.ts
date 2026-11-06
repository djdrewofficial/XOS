import {
  passkeyRegistrationOptions,
  type PasskeyResult,
} from "@/lib/passkeyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: PasskeyResult | { ok: true; options: unknown }, status = 200) {
  return Response.json(body, { status: body.ok ? status : status === 200 ? 400 : status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await passkeyRegistrationOptions(request);
  if (!result.ok) return json(result, result.error.includes("signed in") ? 401 : 400);
  return json(result);
}
