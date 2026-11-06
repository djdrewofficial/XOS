import { passkeyRegistrationVerify } from "@/lib/passkeyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 20_000) {
    return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  let body: { response?: unknown; name?: unknown } = {};
  try {
    body = raw ? (JSON.parse(raw) as { response?: unknown; name?: unknown }) : {};
  } catch {
    return Response.json({ ok: false, error: "That passkey didn't work. Try again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await passkeyRegistrationVerify(request, body.response, body.name);
  return Response.json(result, {
    status: result.ok ? 200 : result.error.includes("signed in") ? 401 : 400,
    headers: { "cache-control": "no-store" },
  });
}
