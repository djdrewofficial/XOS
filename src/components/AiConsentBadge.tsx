import { createClient } from "@/lib/supabase/server";
import { contractClientHasAiConsent } from "@/lib/aiConsent";

/** Staff-facing status for the contract client's AI opt-in. */
export default async function AiConsentBadge({ eventId }: { eventId: string }) {
  const supabase = await createClient();
  const allowed = await contractClientHasAiConsent(supabase, eventId);
  return (
    <span
      className={
        allowed
          ? "rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100"
          : "rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-100"
      }
    >
      {allowed ? "AI allowed" : "AI not allowed"}
    </span>
  );
}
