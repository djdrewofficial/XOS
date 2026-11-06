import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { resolveEventRole, type PlannerRole } from "@/lib/planning";
import { lookupMobileAccountKind } from "@/lib/mobileCouple";
import { noteWriteStatus, parseDoNotPlayPut } from "@/lib/planningNotes";
import { textForViewer } from "@/lib/ugcModeration";
import { viewerBlocks } from "@/lib/ugcModerationServer";

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
  | { role: PlannerRole | null; rls: SupabaseClient; userId: string }
  | { error: NextResponse }
> {
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const rls = userClient(token);
  const { data: userData, error } = await rls.auth.getUser(token);
  if (error || !userData?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const accountType = await lookupMobileAccountKind(rls, userData.user.id);
  if (!accountType) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const role = await resolveEventRole(rls, userData.user.id, accountType, eventId);
  return { role, rls, userId: userData.user.id };
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
  return { eventId, rls: who.rls, role: who.role, userId: who.userId, token } as const;
}

async function readText(
  rls: SupabaseClient,
  eventId: string,
  viewer: { userId: string; role: PlannerRole; token: string },
): Promise<{ text: string | null; hidden?: true }> {
  const full = await rls
    .from("planning_do_not_play_notes")
    .select("body, updated_by, hidden_at")
    .eq("event_id", eventId)
    .maybeSingle();
  const data = full.error && /hidden_at/i.test(full.error.message ?? "")
    ? await rls.from("planning_do_not_play_notes").select("body, updated_by").eq("event_id", eventId).maybeSingle()
    : full;
  const row = data.data as { body?: string | null; updated_by?: string | null; hidden_at?: string | null } | null;
  const blocked = await viewerBlocks(viewer.token, eventId, viewer.userId, viewer.role);
  return textForViewer(row?.body ?? null, row?.updated_by ?? null, Boolean(row?.hidden_at), viewer.role, blocked);
}

export async function GET(req: Request) {
  const gate = await authorize(req, "view");
  if ("error" in gate) return gate.error;
  const viewed = await readText(gate.rls, gate.eventId, gate);
  return NextResponse.json({ text: viewed.text, ...(viewed.hidden ? { hidden: true } : {}) });
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
  const viewed = await readText(gate.rls, gate.eventId, gate);
  return NextResponse.json({ text: viewed.text, ...(viewed.hidden ? { hidden: true } : {}) });
}
