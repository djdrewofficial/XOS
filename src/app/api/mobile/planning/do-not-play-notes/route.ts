import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { resolveEventRole, type PlannerRole } from "@/lib/planning";
import { noteWriteStatus, parseDoNotPlayPut } from "@/lib/planningNotes";

/* Per-event "also avoid" text (artists, genres, styles — not specific songs).
   GET and PUT /api/mobile/planning/do-not-play-notes?eventId=<uuid>
   Body and response: { text: string | null }
   eventId is the query param, the same way the other planning GETs name the
   event (addable-sections). The JSON body is only { text }.
   Hosts and staff. Guests are rejected. Staff need events=view to read and
   events=edit to write. Writes use the caller's JWT so RLS applies. */

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function caller(token: string, eventId: string): Promise<
  | { role: PlannerRole | null; rls: SupabaseClient }
  | { error: NextResponse }
> {
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const rls = userClient(token);
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: acct } = await rls
    .from("accounts")
    .select("account_type")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  const accountType = acct?.account_type as "staff" | "client" | "event_guest" | undefined;
  if (!accountType) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const role = await resolveEventRole(rls, userData.user.id, accountType, eventId);
  return { role, rls };
}

function eventIdFrom(req: Request): string {
  return new URL(req.url).searchParams.get("eventId")?.trim() ?? "";
}

async function authorize(req: Request, need: "view" | "edit") {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const eventId = eventIdFrom(req);
  if (!eventId) return { error: NextResponse.json({ error: "Missing event." }, { status: 400 }) } as const;
  if (!EVENT_ID.test(eventId)) return { error: NextResponse.json({ error: "Missing event." }, { status: 400 }) } as const;

  const who = await caller(token, eventId);
  if ("error" in who) return { error: who.error } as const;
  if (who.role !== "staff" && who.role !== "host") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  if (who.role === "staff") {
    const denied = await requireMobileStaffModule(who.rls, token, "events", need);
    if (denied) return { error: denied } as const;
  }
  return { eventId, rls: who.rls } as const;
}

async function readText(rls: SupabaseClient, eventId: string): Promise<string | null> {
  const { data } = await rls
    .from("planning_do_not_play_notes")
    .select("body")
    .eq("event_id", eventId)
    .maybeSingle();
  return (data?.body as string | null) ?? null;
}

export async function GET(req: Request) {
  const gate = await authorize(req, "view");
  if ("error" in gate) return gate.error;
  return NextResponse.json({ text: await readText(gate.rls, gate.eventId) });
}

export async function PUT(req: Request) {
  const gate = await authorize(req, "edit");
  if ("error" in gate) return gate.error;

  const parsed = parseDoNotPlayPut(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { error } = await gate.rls.from("planning_do_not_play_notes").upsert(
    { event_id: gate.eventId, body: parsed.text },
    { onConflict: "event_id" },
  );
  if (error) {
    const status = noteWriteStatus(error) ?? 500;
    return NextResponse.json({ error: status === 403 ? "Forbidden" : error.message }, { status });
  }
  return NextResponse.json({ text: await readText(gate.rls, gate.eventId) });
}
