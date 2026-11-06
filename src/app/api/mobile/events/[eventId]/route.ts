import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";
import { isUuid, lookupMobileAccountKind } from "@/lib/mobileCouple";

/* Safe event card. Guests do not get prices, pay links, notes, or client ids.
   Hosts and staff get the same card here. Payments and the booking agreement
   stay on their own tables, and those tables are host-only under RLS.
   401 no session. 403 not on this event. 404 unknown id. */

const GUEST_COLUMNS = "id, name, event_date, start_time, end_time, guest_count, cover_photo_url, event_type_id";

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "That event was not found." }, { status: 404 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await rls.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const accountType = await lookupMobileAccountKind(rls, data.user.id);
  if (!accountType) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  const role = await resolveEventRole(rls, data.user.id, accountType, eventId);
  if (!role) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });

  const admin = createAdminClient();
  const { data: event, error: eventErr } = await admin
    .from("events")
    .select(`${GUEST_COLUMNS}, venue:venues(name), event_type:event_types(name)`)
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) return NextResponse.json({ error: "That event was not found." }, { status: 404 });

  const venue = event.venue as { name?: string | null } | null;
  const eventType = event.event_type as { name?: string | null } | null;
  return NextResponse.json({
    role,
    event: {
      id: event.id,
      name: event.name,
      eventDate: event.event_date,
      startTime: event.start_time,
      endTime: event.end_time,
      guestCount: event.guest_count,
      coverPhotoUrl: event.cover_photo_url,
      eventTypeId: event.event_type_id,
      eventType: eventType?.name ?? null,
      venueName: venue?.name ?? null,
    },
  });
}
