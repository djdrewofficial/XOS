import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPaypalOrder, isPaypalConfigured } from "@/lib/paypal";
import { loadPayInfo, withFee } from "@/lib/payInfo";

/* PUBLIC (middleware-exempt). Creates a PayPal order for a pay_token's event.
   The unguessable token is the authorization; the amount is validated against
   the balance server-side so the client can't pay a bogus figure. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isPaypalConfigured()) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }
  let body: { token?: string; amount?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const supabase = createAdminClient();
  const info = await loadPayInfo(supabase, token);
  if (!info) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });
  if (info.balance <= 0) return NextResponse.json({ error: "This event is paid in full." }, { status: 400 });

  if (!info.settings.paypalEnabled) {
    return NextResponse.json({ error: "Card payments aren't available right now." }, { status: 400 });
  }

  // clamp the requested base amount to (0, balance]; default to the suggested figure.
  // PayPal charges base + the convenience fee; the capture re-derives the base.
  const requested = Number(body.amount);
  const base = Math.min(
    info.balance,
    Number.isFinite(requested) && requested > 0 ? requested : info.suggested
  );
  if (!(base > 0)) return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
  const charge = withFee(base, info.settings.paypalFeePct);

  const result = await createPaypalOrder(charge, {
    customId: info.eventId,
    description: `Payment for ${info.eventName ?? "your event"}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ id: result.id });
}
