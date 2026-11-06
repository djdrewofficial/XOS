import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { lookupMobileAccountKind } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { AI_CONSENT_POLICY_VERSION, consentIsActive, type ConsentRow } from "@/lib/aiConsent";

/* Client app opt-in for staff AI tools.
   GET  /api/mobile/ai-consent?eventId=<uuid>
   POST /api/mobile/ai-consent
        { eventId, action: "grant" | "withdraw", policyVersion?, source?: "app" | "web" }

   Response:
   { eventId, granted, grantedAt, withdrawnAt, policyVersion, source }

   Default is not granted. Staff cannot grant or withdraw for a client. */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function present(eventId: string, row: ConsentRow | null) {
  return {
    eventId,
    granted: consentIsActive(row),
    grantedAt: row?.granted_at ?? null,
    withdrawnAt: row?.withdrawn_at ?? null,
    policyVersion: row?.policy_version ?? null,
    source: row?.source ?? null,
  };
}

async function caller(req: Request, eventId: string) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  if (!UUID.test(eventId)) return { error: NextResponse.json({ error: "That event was not found." }, { status: 404 }) };
  const rls = userClient(token);
  const { data, error } = await rls.auth.getUser(token);
  if (error || !data.user) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  const accountType = await lookupMobileAccountKind(rls, data.user.id);
  if (!accountType || accountType === "staff") {
    return { error: NextResponse.json({ error: "You don't have access to that." }, { status: 403 }) };
  }
  const role = await resolveEventRole(rls, data.user.id, accountType, eventId);
  if (role !== "host" && role !== "guest") {
    return { error: NextResponse.json({ error: "You don't have access to that." }, { status: 403 }) };
  }
  const { data: acct } = await rls
    .from("accounts")
    .select("client_id, event_guest_id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  return { rls, userId: data.user.id, clientId: (acct?.client_id as string | null) ?? null, guestId: (acct?.event_guest_id as string | null) ?? null };
}

async function loadRow(rls: ReturnType<typeof userClient>, userId: string, eventId: string) {
  const { data, error } = await rls
    .from("ai_consents")
    .select("granted_at, withdrawn_at, policy_version, source")
    .eq("auth_user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: "AI consent is not available yet." }, { status: 503 }) };
  return { row: (data as ConsentRow | null) ?? null };
}

export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get("eventId")?.trim() ?? "";
  const who = await caller(req, eventId);
  if ("error" in who) return who.error;
  const loaded = await loadRow(who.rls, who.userId, eventId);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(present(eventId, loaded.row));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    eventId?: string;
    action?: string;
    policyVersion?: string;
    source?: string;
  } | null;
  const eventId = (body?.eventId ?? "").trim();
  const who = await caller(req, eventId);
  if ("error" in who) return who.error;
  const action = body?.action;
  if (action !== "grant" && action !== "withdraw") {
    return NextResponse.json({ error: "Action must be grant or withdraw." }, { status: 400 });
  }
  const source = body?.source === "web" ? "web" : "app";
  if (action === "grant") {
    if (body?.policyVersion !== AI_CONSENT_POLICY_VERSION) {
      return NextResponse.json({ error: "Update the app before allowing AI tools." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { error } = await who.rls.from("ai_consents").upsert(
      {
        auth_user_id: who.userId,
        client_id: who.clientId,
        event_guest_id: who.guestId,
        event_id: eventId,
        granted_at: now,
        withdrawn_at: null,
        policy_version: AI_CONSENT_POLICY_VERSION,
        source,
        updated_at: now,
      },
      { onConflict: "auth_user_id,event_id" },
    );
    if (error) return NextResponse.json({ error: "Could not save AI consent." }, { status: 500 });
  } else {
    const now = new Date().toISOString();
    const { error } = await who.rls
      .from("ai_consents")
      .update({ withdrawn_at: now, updated_at: now })
      .eq("auth_user_id", who.userId)
      .eq("event_id", eventId);
    if (error) return NextResponse.json({ error: "Could not withdraw AI consent." }, { status: 500 });
  }
  const loaded = await loadRow(who.rls, who.userId, eventId);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(present(eventId, loaded.row));
}
