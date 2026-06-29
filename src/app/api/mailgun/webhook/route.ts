import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* Mailgun delivery-event webhook → updates email_log status.
   Point Mailgun here: Sending → Webhooks → add for "delivered", "opened",
   "permanent failure", "temporary failure", "complained":
     https://YOUR-APP-DOMAIN/api/mailgun/webhook
   Set MAILGUN_SIGNING_KEY in .env.local (Sending → Webhooks → HTTP webhook signing key). */

export const dynamic = "force-dynamic";

type MailgunSignature = { timestamp: string; token: string; signature: string };
type MailgunPayload = {
  signature?: MailgunSignature;
  "event-data"?: {
    event?: string;
    severity?: string;
    message?: { headers?: { "message-id"?: string } };
  };
};

function verify(sig: MailgunSignature | undefined, signingKey: string): boolean {
  if (!sig?.timestamp || !sig?.token || !sig?.signature) return false;
  const digest = createHmac("sha256", signingKey)
    .update(sig.timestamp + sig.token)
    .digest("hex");
  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(sig.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const signingKey = process.env.MAILGUN_SIGNING_KEY;
  if (!signingKey) {
    return NextResponse.json({ error: "MAILGUN_SIGNING_KEY not set" }, { status: 500 });
  }

  let payload: MailgunPayload;
  try {
    payload = (await req.json()) as MailgunPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!verify(payload.signature, signingKey)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const data = payload["event-data"];
  const messageId = (data?.message?.headers?.["message-id"] ?? "").replace(/^<|>$/g, "");
  if (!data?.event || !messageId) {
    return NextResponse.json({ ok: true, note: "nothing to update" });
  }

  const now = new Date().toISOString();
  const update: Record<string, string | null> = {};
  switch (data.event) {
    case "delivered":
      update.status = "delivered";
      update.delivered_at = now;
      break;
    case "opened":
      update.status = "opened";
      update.opened_at = now;
      break;
    case "failed":
      update.status = data.severity === "permanent" ? "bounced" : "failed";
      update.error = `Mailgun ${data.severity ?? ""} failure`.trim();
      break;
    case "complained":
      update.status = "complained";
      break;
    default:
      return NextResponse.json({ ok: true, note: `ignored event ${data.event}` });
  }

  const supabase = createAdminClient();
  // Don't let a late "delivered" overwrite an "opened" (opened is the stronger signal).
  let query = supabase.from("email_log").update(update).eq("provider_message_id", messageId);
  // Don't let a late "delivered" overwrite an "opened" (the immutable-chained builder
  // must be reassigned, otherwise the filter is silently dropped).
  if (data.event === "delivered") query = query.neq("status", "opened");
  await query;

  return NextResponse.json({ ok: true });
}
