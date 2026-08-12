import { createAdminClient } from "@/lib/supabase/admin";
import { emailFromUnsubToken, recordEmailOptSignal } from "@/lib/emailOptOut";
import { appUrl } from "@/lib/signing";

/* PUBLIC (middleware-exempt). CAN-SPAM unsubscribe for marketing email. Reached
   two ways:
   - POST  → RFC 8058 one-click, sent by the mailbox provider from the
             List-Unsubscribe / List-Unsubscribe-Post headers. Opt out, 200.
   - GET   → a human clicking the footer link. Opt out and show a confirmation
             page; ?resubscribe=1 opts back in.
   Only affects MARKETING mail — transactional mail (agreements, receipts,
   invites, reminders) is never suppressed. */

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlPage(title: string, bodyHtml: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f2fa;font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;color:#2c2c33;">
  <div style="max-width:520px;margin:60px auto;padding:0 16px;">
    <div style="background:#fff;border:1px solid #e8e4f3;border-radius:16px;padding:34px 30px;text-align:center;">
      <h1 style="font-size:22px;color:#1d1d22;margin:0 0 12px;">${esc(title)}</h1>
      ${bodyHtml}
    </div>
  </div>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 },
  );
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const email = emailFromUnsubToken(token);
  if (email) {
    await recordEmailOptSignal(createAdminClient(), email, {
      optedOut: true,
      source: "one_click",
      reason: "List-Unsubscribe one-click",
    });
  }
  // Always 200 for one-click so the provider records success.
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const email = emailFromUnsubToken(token);
  if (!email) {
    return htmlPage(
      "Link not valid",
      `<p style="color:#55555e;line-height:1.6;">This unsubscribe link is invalid or expired. Reply to any of our emails and ask to be removed, and we’ll take care of it.</p>`,
    );
  }

  const resubscribe = new URL(req.url).searchParams.get("resubscribe") === "1";
  await recordEmailOptSignal(createAdminClient(), email, {
    optedOut: !resubscribe,
    source: resubscribe ? "resubscribe_link" : "unsubscribe_link",
    reason: resubscribe ? "clicked resubscribe" : "clicked unsubscribe link",
  });

  if (resubscribe) {
    return htmlPage(
      "You’re resubscribed",
      `<p style="color:#55555e;line-height:1.6;"><strong>${esc(email)}</strong> will receive our emails again.</p>`,
    );
  }

  const resubUrl = `${appUrl()}/api/unsubscribe/${encodeURIComponent(token)}?resubscribe=1`;
  return htmlPage(
    "You’ve been unsubscribed",
    `<p style="color:#55555e;line-height:1.6;"><strong>${esc(email)}</strong> won’t receive marketing emails from us anymore.</p>
     <p style="color:#55555e;line-height:1.6;">You’ll still get important messages about your event — booking agreements, receipts, and reminders.</p>
     <p style="margin-top:22px;"><a href="${esc(resubUrl)}" style="color:#4b328e;font-weight:600;">Changed your mind? Resubscribe</a></p>`,
  );
}
