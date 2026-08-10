import { NextResponse } from "next/server";

/* Delivery URL for the GHL "XOS" Conversation Provider.
   GHL requires a delivery webhook when registering a custom conversation
   provider; it's called when a message is SENT through this provider from inside
   GoHighLevel. XOS never sends through this provider — it only uses the
   /conversations/messages/outbound API to LOG emails that Mailgun already
   delivered — so this is a deliberate no-op that just acknowledges the call.

   If it ever actually fires, someone set the XOS provider as the ACTIVE email
   provider in the sub-account (Settings → Email Services), which it must not be;
   we log loudly so that misconfiguration is noticed. Public route — GHL calls it
   with no XOS session (see middleware allow-list). */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.text();
    console.warn(
      "Unexpected GHL delivery webhook — the XOS conversation provider is log-only and must not be the active sender:",
      body.slice(0, 500),
    );
  } catch {
    /* ignore body read errors — we acknowledge regardless */
  }
  return NextResponse.json({ status: "ignored" });
}

// GHL may probe the URL with a GET when saving the provider — answer 200 so it validates.
export async function GET() {
  return NextResponse.json({ ok: true });
}
