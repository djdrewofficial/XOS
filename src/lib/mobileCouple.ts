/* Auth for the couple-app membership routes. A missing accounts row is not
   staff. Only a host (client linked to the event) can manage invites and the
   join code. Guests cannot. */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveEventRole } from "@/lib/planning";
import { coupleManageDecision, type AccountKind } from "@/lib/eventAccess";
import { AccessError } from "@/lib/eventAccessServer";

export function bearerToken(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export function requestIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function userClient(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type MobileCaller = {
  userId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  accountType: AccountKind;
  clientId: string | null;
};

export async function requireMobileUser(req: Request): Promise<MobileCaller | NextResponse> {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const rls = userClient(token);
  const { data, error } = await rls.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: acct } = await rls
    .from("accounts")
    .select("account_type, client_id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  const accountType = (acct?.account_type as AccountKind) ?? null;
  const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const displayName = (meta?.full_name || meta?.name || "").trim() || null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
    displayName,
    accountType: accountType === "staff" || accountType === "client" || accountType === "event_guest" ? accountType : null,
    clientId: (acct?.client_id as string | null) ?? null,
  };
}

export async function requireCoupleHost(req: Request, eventId: string): Promise<MobileCaller | NextResponse> {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;
  if (!caller.accountType) {
    return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  }
  const rls = userClient(bearerToken(req));
  const role = await resolveEventRole(rls, caller.userId, caller.accountType, eventId);
  if (coupleManageDecision(role) !== "ok") {
    return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  }
  return caller;
}

export function accessResponse(err: unknown): NextResponse {
  if (err instanceof AccessError) {
    const headers = err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined;
    return NextResponse.json({ error: err.message }, { status: err.status, headers });
  }
  console.error(err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
