import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTranscript } from "@/lib/fireflies";

/* Fireflies webhook: fires when a meeting finishes transcribing. We fetch the full
   transcript by id and import it (matching to a client/event by email). If
   FIREFLIES_WEBHOOK_SECRET is set, the request is HMAC-verified (Fireflies signs the
   raw body as sha256 in x-hub-signature). Public route — exempt in middleware. */

export const dynamic = "force-dynamic";

function verify(raw: string, header: string | null, secret: string): boolean {
  const sig = (header ?? "").replace(/^sha256=/, "").trim();
  if (!sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();

  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;
  if (secret && !verify(raw, req.headers.get("x-hub-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: { meetingId?: string; eventType?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const meetingId = body.meetingId;
  if (!meetingId) return NextResponse.json({ error: "missing meetingId" }, { status: 400 });
  // Only import once transcription is ready; ignore other event types.
  if (body.eventType && !/transcription|completed/i.test(body.eventType)) {
    return NextResponse.json({ ok: true, skipped: body.eventType });
  }

  try {
    const admin = createAdminClient();
    const id = await importTranscript(admin, meetingId);
    return NextResponse.json({ ok: !!id, meetingId });
  } catch (e) {
    console.error("[fireflies webhook] import failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "import failed" }, { status: 500 });
  }
}

// A GET is handy for a quick liveness check from the Fireflies setup UI.
export async function GET() {
  return NextResponse.json({ ok: true, service: "fireflies-webhook" });
}
