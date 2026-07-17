import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import ViboDownload from "@/components/ViboDownload";
import ViboInvite from "@/components/ViboInvite";
import RawEmbed from "@/components/RawEmbed";
import { loadEventJourney } from "@/lib/eventJourney";

/* PUBLIC Vibo planning page — the post-payment "let's start planning" screen.
   Explains Vibo, device-aware download links, the join link (set by the Zapier
   zap on signing), and an option to text a partner/planner an invite. */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:p-8`}>
        <div className="mb-5 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Xpress Entertainment" className="h-10 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Xpress Entertainment" className="hidden h-10 dark:block" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Normalize a Vimeo link/url to a player embed URL. */
function vimeoEmbed(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.includes("player.vimeo.com")) return u;
  const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return u; // assume it's already an embeddable URL
}

export default async function ViboPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();
  const [{ data: event }, { data: js }] = await Promise.all([
    supabase.from("events").select("name, custom_fields, journey_type_id, client:clients(first_name)").eq("pay_token", token).maybeSingle(),
    supabase
      .from("journey_settings")
      .select("vibo_intro, vibo_video_url, vibo_ios_url, vibo_android_url, vibo_web_url")
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (!event) {
    return (
      <Shell>
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          This link isn&apos;t valid. Please reach out to us for an updated one.
        </p>
      </Shell>
    );
  }

  const journey = await loadEventJourney(supabase, event.journey_type_id);
  const first = (event.client as { first_name?: string } | null)?.first_name ?? "there";
  const viboLink = ((event.custom_fields as Record<string, string>) ?? {}).vibo_link || "";
  const s = (js ?? {}) as {
    vibo_intro?: string;
    vibo_video_url?: string | null;
    vibo_ios_url?: string | null;
    vibo_android_url?: string | null;
    vibo_web_url?: string | null;
  };
  const embed = vimeoEmbed(s.vibo_video_url ?? null);
  const showMeeting = journey.step_book_meeting && !!journey.calendar_embed;
  const heading = journey.final_page_heading || "Let's start planning";

  return (
    <Shell wide={showMeeting}>
      <div className="mb-4 text-center">
        <h1 className="text-xl font-extrabold text-zinc-900 dark:text-white">{heading}, {first}! 🎶</h1>
        {journey.final_page_body && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{journey.final_page_body}</p>
        )}
      </div>

      {/* Venue-partner order: book the onboarding meeting FIRST, then download
          the app. Direct journeys skip the step labels and the meeting block. */}
      {showMeeting && (
        <div className="mb-6">
          <p className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
            Step 1 — Book your onboarding
          </p>
          <h2 className="mb-1 text-center text-base font-bold text-zinc-900 dark:text-white">
            Book your Exclusive Venue Onboarding
          </h2>
          <p className="mb-3 text-center text-xs text-zinc-500">Pick a time that works for you — this is where we plan the details together.</p>
          <RawEmbed html={journey.calendar_embed as string} />
        </div>
      )}

      {showMeeting && (
        <div className="mb-3 border-t border-zinc-200 pt-5 text-center dark:border-white/10">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
            Step 2 — Download the app &amp; log in
          </p>
          <p className="mt-1 text-xs text-zinc-500">Sign in with the login details we just emailed you.</p>
        </div>
      )}

      {embed && (
        <div className="mb-4 aspect-video overflow-hidden rounded-xl bg-black">
          <iframe src={embed} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="About Vibo" />
        </div>
      )}

      {s.vibo_intro && <p className="mb-4 text-center text-sm text-zinc-600 dark:text-zinc-300">{s.vibo_intro}</p>}

      <div className="space-y-3">
        <ViboDownload iosUrl={s.vibo_ios_url ?? null} androidUrl={s.vibo_android_url ?? null} webUrl={s.vibo_web_url ?? null} />

        {viboLink ? (
          <a
            href={viboLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl border-2 border-brand px-4 py-3 text-center text-sm font-bold text-brand transition-colors hover:bg-brand/5 dark:text-brand-lighter"
          >
            Join your event in Vibo →
          </a>
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            Your event is being set up — check back here shortly for your join link. (You can download the app now.)
          </div>
        )}

        <div className="pt-1">
          <ViboInvite token={token} />
        </div>
      </div>

      <p className="mt-5 text-center text-[11px] text-zinc-400">
        Planning together makes it perfect — invite your partner, planner, or anyone helping with the day.
      </p>
    </Shell>
  );
}
