import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { createJourneyType } from "./actions";

export const dynamic = "force-dynamic";

const STEP_LABELS: [keyof JourneyRow, string][] = [
  ["step_confirm_info", "Confirm info"],
  ["step_sign_agreement", "Sign agreement"],
  ["step_payment", "Payment"],
  ["step_app_onboarding", "App onboarding"],
  ["step_book_meeting", "Book meeting"],
  ["step_planner", "Planner"],
];

type JourneyRow = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  step_confirm_info: boolean;
  step_sign_agreement: boolean;
  step_payment: boolean;
  step_app_onboarding: boolean;
  step_book_meeting: boolean;
  step_planner: boolean;
};

export default async function JourneyTypesPage() {
  await requireModule("settings", "view", { mode: "redirect" });
  const supabase = await createClient();
  const { data } = await supabase
    .from("journey_types")
    .select(
      "id, name, description, is_default, is_active, step_confirm_info, step_sign_agreement, step_payment, step_app_onboarding, step_book_meeting, step_planner",
    )
    .order("sort_order");
  const journeys = (data ?? []) as JourneyRow[];

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Journey Types</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Define the paths a client takes after booking. The default journey is the standard flow (confirm → sign → pay →
        plan). Add others — like a venue-partner path with no payment — and assign them with a booking helper&apos;s{" "}
        <em>Start Client Journey</em> action.
      </p>

      <div className="space-y-2">
        {journeys.map((j) => (
          <Link
            key={j.id}
            href={`/settings/journeys/${j.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-brand/50 dark:border-white/10 dark:bg-white/[0.02]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-900 dark:text-white">{j.name}</span>
                {j.is_default && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase text-brand dark:text-brand-lighter">
                    Default
                  </span>
                )}
                {!j.is_active && (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:bg-white/10">
                    Inactive
                  </span>
                )}
              </div>
              {j.description && <p className="mt-0.5 truncate text-xs text-zinc-500">{j.description}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {STEP_LABELS.filter(([k]) => j[k]).map(([k, label]) => (
                  <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <span className="shrink-0 text-sm text-brand dark:text-brand-lighter">Edit →</span>
          </Link>
        ))}
      </div>

      <form action={createJourneyType} className="mt-6 flex items-end gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-white/15">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-500">New journey name</span>
          <input name="name" required placeholder="e.g. Villa Toscana" className="input w-full" />
        </label>
        {/* sensible defaults for a new journey: confirm + sign + planner on */}
        <input type="hidden" name="step_confirm_info" value="on" />
        <input type="hidden" name="step_sign_agreement" value="on" />
        <input type="hidden" name="step_planner" value="on" />
        <input type="hidden" name="is_active" value="on" />
        <button type="submit" className="btn-primary px-5">Create</button>
      </form>
    </div>
  );
}
