import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe } from "@/lib/auth";
import { syncEventSections } from "@/lib/spotifySync";
import { loadEventAccount, loadClientMessages } from "@/lib/eventAccount";
import {
  ensureEventPlanning,
  loadEventPlanning,
  loadEventPeople,
  loadEventVendors,
  resolveEventRole,
} from "@/lib/planning";
import Planner from "@/components/planner/Planner";
import ThemeToggleIcon from "@/components/planner/ThemeToggleIcon";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

/* The client experience planner — the in-house Vibo. Hosts (clients on the
   event) get the full experience; invited Guests only answer the questions staff
   flagged guest_enabled; staff can preview/edit everything. */
export default async function PlannerPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) redirect("/login");

  const { data: event } = await supabase
    .from("events")
    .select("id, name, event_date, event_type_id, cover_photo_url")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) notFound();

  const role = await resolveEventRole(supabase, me.userId, me.accountType, eventId);
  if (!role) notFound();

  // Seed sections from the matching template on first open (admin client).
  await ensureEventPlanning(eventId, event.event_type_id);

  // Pull fresh songs for any live-synced sections (throttled; best-effort).
  try {
    await syncEventSections(createAdminClient(), eventId);
  } catch {
    /* a Spotify hiccup must never block the planner */
  }

  const planning = await loadEventPlanning(supabase, eventId, me.userId, role);
  const people = role === "guest" ? { hosts: [], guests: [] } : await loadEventPeople(supabase, eventId);
  const vendors = role === "guest" ? [] : await loadEventVendors(supabase, eventId);
  // "My Event" tab data — financials + sent emails/texts (admin read, role-gated).
  const admin2 = createAdminClient();
  const account = role === "guest" ? null : await loadEventAccount(admin2, eventId, role);
  const messages = role === "guest" ? { emails: [], texts: [] } : await loadClientMessages(admin2, eventId);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl dark:border-white/[0.06] dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {role === "staff" && (
              <Link
                href={`/events/${eventId}`}
                className="text-sm text-zinc-500 hover:text-brand dark:text-zinc-400"
              >
                ← Event
              </Link>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-light.png" alt="Xpress Entertainment" className="h-7 dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="Xpress Entertainment" className="hidden h-7 dark:block" />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggleIcon />
            <RoleBadge role={role} />
            {role !== "staff" && <SignOutButton />}
          </div>
        </div>
      </header>

      <Planner
        eventId={eventId}
        eventName={event.name || "Your Event"}
        eventDate={event.event_date}
        coverPhotoUrl={event.cover_photo_url}
        planning={planning}
        people={people}
        vendors={vendors}
        role={role}
        account={account}
        messages={messages}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: "staff" | "host" | "guest" }) {
  const map = {
    staff: { label: "Staff preview", cls: "bg-brand/10 text-brand dark:text-brand-lighter" },
    host: { label: "Host", cls: "bg-brand/10 text-brand dark:text-brand-lighter" },
    guest: { label: "Guest", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  } as const;
  const m = map[role];
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
