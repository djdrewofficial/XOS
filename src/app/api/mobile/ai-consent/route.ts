import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { lookupMobileAccountKind } from "@/lib/mobileCouple";
import { resolveEventRole } from "@/lib/planning";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_CONSENT_POLICY_VERSION, consentIsActive, contractClientAuthUserId, type ConsentRow } from "@/lib/aiConsent";

/* Legacy client AI consent rows (table kept; staff tools no longer gate on them).
   GET  /api/mobile/ai-consent?eventId=<uuid>
   POST /api/mobile/ai-consent
        { eventId, action: "grant" | "withdraw", policyVersion?, source?: "app" | "web" }

   Response:
   { eventId, granted, grantedAt, withdrawnAt, policyVersion, source }

   Staff AI tools ignore these rows. Staff cannot grant or withdraw for a client. */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function present(eventId: string, row: ConsentRow | null, who: { userId: string; clientId: string | null; guestId: string | null }) {
  const granted = consentIsActive(row);
  return {
    eventId,
    granted,
    grantedAt: row?.granted_at ?? null,
    withdrawnAt: row?.withdrawn_at ?? null,
    policyVersion: row?.policy_version ?? null,
    source: row?.source ?? null,
    actor: {
      authUserId: who.userId,
      role: "contract_client",
      clientId: who.clientId,
      eventGuestId: who.guestId,
    },
    capability: {
      canGrant: !granted,
      canWithdraw: granted,
      reason: null,
    },
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
  const contractUserId = await contractClientAuthUserId(rls, eventId);
  if (contractUserId !== data.user.id) {
    return {
      error: NextResponse.json(
        { error: "not_contract_client", capability: { canGrant: false, canWithdraw: false, reason: "not_contract_client" } },
        { status: 403 },
      ),
    };
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
  return NextResponse.json(present(eventId, loaded.row, who));
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
  if (action === "grant" && body?.policyVersion !== AI_CONSENT_POLICY_VERSION) {
    return NextResponse.json({ error: "Update the app before allowing AI tools." }, { status: 400 });
  }
  if (!who.clientId) {
    return NextResponse.json(
      { error: "not_contract_client", capability: { canGrant: false, canWithdraw: false, reason: "not_contract_client" } },
      { status: 403 },
    );
  }
  const { error } = await createAdminClient().rpc("ai_consent_save", {
    p_auth_user_id: who.userId,
    p_event_id: eventId,
    p_action: action,
    p_policy_version: AI_CONSENT_POLICY_VERSION,
    p_source: source,
  });
  if (error) {
    const denied = error.code === "42501" || /contract|account|staff/i.test(error.message);
    return NextResponse.json(
      { error: denied ? "You don't have access to that." : "Could not save AI consent." },
      { status: denied ? 403 : 500 },
    );
  }
  const loaded = await loadRow(who.rls, who.userId, eventId);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(present(eventId, loaded.row, who));
}
