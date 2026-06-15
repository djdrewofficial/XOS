import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPaypalConfigured } from "@/lib/paypal";
import { runAutopayCharges } from "@/lib/autopay";

/* Protected autopay runner. Trigger once a day with header:
   Authorization: Bearer <CRON_SECRET>.  Charges each armed event's earliest
   due, unpaid scheduled payment against its vaulted PayPal method. */

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPaypalConfigured()) return NextResponse.json({ error: "PayPal not configured" }, { status: 503 });
  const admin = createAdminClient();
  const result = await runAutopayCharges(admin);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
