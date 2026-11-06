import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupMobileAccountKind } from "@/lib/mobileCouple";
import {
  SMS_MARKETING_DISCLOSURE_VERSION,
  currentMarketingConsent,
  normalizeConsentPhone,
  type MarketingConsentEvent,
} from "@/lib/smsMarketingConsent";

/* Marketing text choice for the signed-in person.
   GET  /api/mobile/sms-marketing-consent
   POST { action: "grant" | "withdraw" | "skip", disclosureVersion?, source?: "app" | "web", eventId? }

   Skip writes nothing. Grant writes nothing when no mobile number is on file.
   This does not send a text, does not change email consent, and does not change STOP. */

export const dynamic = "force-dynamic";

function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function caller(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  const rls = userClient(token);
  const { data, error } = await rls.auth.getUser(token);
  if (error || !data.user) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  const accountType = await lookupMobileAccountKind(rls, data.user.id);
  if (!accountType || accountType === "staff") {
    return { error: NextResponse.json({ error: "You don't have access to that." }, { status: 403 }) };
  }
  const { data: acct } = await rls
    .from("accounts")
    .select("account_type, client_id, event_guest_id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  const clientId = (acct?.client_id as string | null) ?? null;
  const eventGuestId = (acct?.event_guest_id as string | null) ?? null;
  let rawPhone: string | null = null;
  let phoneField: "clients.cell_phone" | null = null;
  if (clientId) {
    const { data: client } = await rls.from("clients").select("cell_phone").eq("id", clientId).maybeSingle();
    if (typeof client?.cell_phone === "string" && client.cell_phone.trim()) {
      rawPhone = client.cell_phone;
      phoneField = "clients.cell_phone";
    }
  }
  return {
    rls,
    userId: data.user.id,
    accountType,
    clientId,
    eventGuestId,
    phone: normalizeConsentPhone(rawPhone),
    phoneField,
  };
}

async function history(rls: ReturnType<typeof userClient>, userId: string): Promise<MarketingConsentEvent[] | null> {
  const { data, error } = await rls
    .from("sms_marketing_consent_events")
    .select("action, phone_e164, disclosure_version, source, created_at")
    .eq("auth_user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return null;
  return (data ?? []).map((row) => ({
    action: row.action as MarketingConsentEvent["action"],
    phone: row.phone_e164 as string,
    createdAt: row.created_at as string,
    disclosureVersion: row.disclosure_version as string,
    source: row.source as string,
  }));
}

function present(who: {
  userId: string;
  accountType: "client" | "event_guest";
  clientId: string | null;
  eventGuestId: string | null;
  phone: string | null;
  phoneField: "clients.cell_phone" | null;
}, events: MarketingConsentEvent[]) {
  const current = currentMarketingConsent(events, who.phone);
  const reason = !who.phone ? "no_mobile_number" : null;
  return {
    disclosureVersion: SMS_MARKETING_DISCLOSURE_VERSION,
    granted: current.granted,
    saved: {
      granted: current.granted,
      grantedAt: current.granted ? current.event?.createdAt ?? null : null,
      withdrawnAt: current.event?.action === "withdraw" ? current.event.createdAt : null,
      disclosureVersion: current.event?.disclosureVersion ?? null,
      source: current.event?.source ?? null,
      phone: current.event?.phone ?? null,
    },
    eligibleNumber: {
      e164: who.phone,
      onFile: Boolean(who.phone),
      source: who.phone ? who.phoneField : null,
    },
    actor: {
      authUserId: who.userId,
      accountType: who.accountType,
      clientId: who.clientId,
      eventGuestId: who.eventGuestId,
    },
    capability: {
      canGrant: Boolean(who.phone) && !current.granted,
      canWithdraw: current.granted,
      reason,
    },
    history: events.map((event) => ({
      action: event.action,
      phone: event.phone,
      disclosureVersion: event.disclosureVersion,
      source: event.source,
      createdAt: event.createdAt,
    })),
  };
}

export async function GET(req: Request) {
  const who = await caller(req);
  if ("error" in who) return who.error;
  const events = await history(who.rls, who.userId);
  if (!events) return NextResponse.json({ error: "SMS marketing consent is not available yet." }, { status: 503 });
  return NextResponse.json(present(who, events));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    disclosureVersion?: string;
    source?: string;
    eventId?: string;
  } | null;
  const who = await caller(req);
  if ("error" in who) return who.error;
  const action = body?.action;
  if (action !== "grant" && action !== "withdraw" && action !== "skip") {
    return NextResponse.json({ error: "Action must be grant, withdraw, or skip." }, { status: 400 });
  }
  const events = await history(who.rls, who.userId);
  if (!events) return NextResponse.json({ error: "SMS marketing consent is not available yet." }, { status: 503 });
  if (action === "skip") return NextResponse.json(present(who, events));
  if (!who.phone && action === "grant") return NextResponse.json(present(who, events));
  if (action === "grant" && body?.disclosureVersion !== SMS_MARKETING_DISCLOSURE_VERSION) {
    return NextResponse.json({ error: "Update the app before allowing marketing texts." }, { status: 400 });
  }
  const priorGrant = [...events].reverse().find((event) => event.action === "grant");
  const phoneToRecord = who.phone ?? (action === "withdraw" ? priorGrant?.phone ?? null : null);
  if (!phoneToRecord) return NextResponse.json(present(who, events));
  const source = body?.source === "web" ? "web" : "app";
  const eventId = typeof body?.eventId === "string" && body.eventId.trim() ? body.eventId.trim() : null;
  const { error } = await who.rls.from("sms_marketing_consent_events").insert({
    auth_user_id: who.userId,
    client_id: who.clientId,
    event_id: eventId,
    phone_e164: phoneToRecord,
    action,
    disclosure_version: body?.disclosureVersion || SMS_MARKETING_DISCLOSURE_VERSION,
    source,
  });
  if (error) return NextResponse.json({ error: "Could not save the texting choice." }, { status: 500 });

  if (who.clientId) {
    const admin = createAdminClient();
    await admin
      .from("clients")
      .update({
        sms_opt_in: action === "grant",
        sms_opt_in_at: action === "grant" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", who.clientId);
  }

  const next = (await history(who.rls, who.userId)) ?? events;
  return NextResponse.json(present(who, next));
}
