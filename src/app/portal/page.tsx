import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMusic, faListCheck, faArrowRight } from "@fortawesome/free-solid-svg-icons";

export const dynamic = "force-dynamic";

/* Planning portal — the home for Client and Event Guest logins. Lists the
   events this person can plan and links into the in-house planner (/portal/plan). */
export default async function PortalPage() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) redirect("/login");

  if (me.accountType === "staff") {
    // staff don't belong here — bounce them to the app
    redirect("/");
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("account_type, client_id, event_guest_id")
    .eq("auth_user_id", me.userId)
    .maybeSingle();

  let name = "";
  type EventLite = { id: string; name: string; event_date: string | null };
  const events: EventLite[] = [];

  if (account?.client_id) {
    const { data: c } = await supabase
      .from("clients")
      .select("first_name")
      .eq("id", account.client_id)
      .maybeSingle();
    name = c?.first_name ?? "";

    const [{ data: primary }, { data: linked }] = await Promise.all([
      supabase
        .from("events")
        .select("id, name, event_date")
        .eq("client_id", account.client_id)
        .is("archived_at", null),
      supabase
        .from("event_clients")
        .select("event:events(id, name, event_date, archived_at)")
        .eq("client_id", account.client_id),
    ]);
    const seen = new Set<string>();
    for (const e of primary ?? []) {
      if (!seen.has(e.id)) { seen.add(e.id); events.push(e); }
    }
    for (const row of linked ?? []) {
      const e = row.event as unknown as (EventLite & { archived_at: string | null }) | null;
      if (e && !e.archived_at && !seen.has(e.id)) { seen.add(e.id); events.push(e); }
    }
  } else if (account?.event_guest_id) {
    const { data: g } = await supabase
      .from("event_guests")
      .select("first_name, event:events(id, name, event_date)")
      .eq("id", account.event_guest_id)
      .maybeSingle();
    name = g?.first_name ?? "";
    const e = g?.event as unknown as EventLite | null;
    if (e) events.push(e);
  }

  events.sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="w-44 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="hidden w-44 dark:block" />
        <SignOutButton />
      </div>

      <div className="card p-8">
        <h1 className="page-title mb-1">Welcome{name ? `, ${name}` : ""}!</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          This is your event planning portal — build your music and timeline with your DJ.
        </p>

        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-white/10">
            No events are linked to your account yet. Your DJ will set this up shortly.
          </p>
        ) : (
          <div className="space-y-3">
            {events.map((e) => (
              <Link
                key={e.id}
                href={`/portal/plan/${e.id}`}
                className="group flex items-center justify-between rounded-xl border border-zinc-200 p-5 transition-colors hover:border-brand dark:border-white/[0.08] dark:hover:border-brand-light/60"
              >
                <div>
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">{e.name || "Your Event"}</p>
                  {e.event_date && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {new Date(e.event_date + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                  <div className="mt-2 flex gap-3 text-xs text-zinc-400">
                    <span><FontAwesomeIcon icon={faMusic} className="mr-1" />Music</span>
                    <span><FontAwesomeIcon icon={faListCheck} className="mr-1" />Timeline & Questions</span>
                  </div>
                </div>
                <FontAwesomeIcon
                  icon={faArrowRight}
                  className="text-zinc-300 transition-colors group-hover:text-brand dark:group-hover:text-brand-lighter"
                />
              </Link>
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-zinc-400">
          Need help? Reply to your invitation email or{" "}
          <Link href="/login" className="font-semibold text-brand underline dark:text-brand-lighter">
            sign in again
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
