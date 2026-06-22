import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";
import { sendAccountInvite } from "@/lib/accounts";

/* Invite a partner or planner from the couple's app. The host (couple) submits a
   name + email + relationship; we create/refresh the event_guests row and send the
   branded set-password invite via Mailgun (sendAccountInvite). Only staff or the
   event's hosts may invite — guests cannot. JWT-verified via the /api/mobile/
   prefix. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const body = await req.json().catch(() => null);
  const eventId = String(body?.eventId ?? "");
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const relationship = String(body?.relationship ?? "").trim() || null;
  if (!eventId) return NextResponse.json({ error: "Missing event." }, { status: 400 });
  if (!firstName || !lastName) return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });

  // Only the couple (host) or staff can invite people to an event.
  const { data: acct } = await rls.from("accounts").select("account_type").eq("auth_user_id", uid).maybeSingle();
  const accountType = (acct?.account_type as "staff" | "client" | "event_guest" | undefined) ?? "staff";
  const role = await resolveEventRole(rls, uid, accountType, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Reuse an existing guest with this email on this event (case-insensitive) so
  // re-inviting refreshes rather than duplicates.
  const { data: guests } = await admin.from("event_guests").select("id, email").eq("event_id", eventId);
  const existing = (guests ?? []).find((g) => (g.email ?? "").toLowerCase() === email);

  let guestId = existing?.id as string | undefined;
  if (guestId) {
    await admin
      .from("event_guests")
      .update({ first_name: firstName, last_name: lastName, email, relationship })
      .eq("id", guestId);
  } else {
    const { data: ins, error: insErr } = await admin
      .from("event_guests")
      .insert({ event_id: eventId, first_name: firstName, last_name: lastName, email, relationship })
      .select("id")
      .single();
    if (insErr || !ins) return NextResponse.json({ error: insErr?.message ?? "Could not save the guest." }, { status: 500 });
    guestId = ins.id as string;
  }

  const res = await sendAccountInvite({ type: "event_guest", email, name: firstName, eventGuestId: guestId });
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Could not send the invite." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
