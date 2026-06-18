import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMusic, faListCheck } from "@fortawesome/free-solid-svg-icons";

export const dynamic = "force-dynamic";

/* Planning portal — the home for Client and Event Guest logins. Placeholder
   shell for the in-house Vibo replacement (music picker + timeline builder). */
export default async function PortalPage() {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) redirect("/login");

  // Resolve a friendly name + the event(s) this person is tied to.
  let name = "";
  let eventName: string | null = null;
  if (me.accountType === "staff") {
    // staff don't belong here — bounce them to the app
    redirect("/");
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("account_type, client_id, event_guest_id")
    .eq("auth_user_id", me.userId)
    .maybeSingle();

  if (account?.client_id) {
    const { data: c } = await supabase
      .from("clients")
      .select("first_name")
      .eq("id", account.client_id)
      .maybeSingle();
    name = c?.first_name ?? "";
  } else if (account?.event_guest_id) {
    const { data: g } = await supabase
      .from("event_guests")
      .select("first_name, event:events(name)")
      .eq("id", account.event_guest_id)
      .maybeSingle();
    name = g?.first_name ?? "";
    eventName = (g?.event as { name?: string } | null)?.name ?? null;
  }

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
        <h1 className="page-title mb-1">
          Welcome{name ? `, ${name}` : ""}!
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          {eventName ? `${eventName} · ` : ""}This is your event planning portal.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 p-5 dark:border-white/[0.08]">
            <div className="mb-2 text-2xl text-brand dark:text-brand-lighter">
              <FontAwesomeIcon icon={faMusic} />
            </div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">Music</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Pick your must-plays, do-not-plays, and special songs. Coming soon.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-5 dark:border-white/[0.08]">
            <div className="mb-2 text-2xl text-brand dark:text-brand-lighter">
              <FontAwesomeIcon icon={faListCheck} />
            </div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">Timeline</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Build your event timeline with your DJ. Coming soon.
            </p>
          </div>
        </div>

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
