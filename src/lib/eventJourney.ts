/* Resolve which client journey an event is on. An event with no
   journey_type_id follows the built-in Direct flow (everything on); a set
   journey_type_id loads that journey's step toggles + agreement + calendar.
   Server-only shape — callers pass their own supabase client. */

import type { SupabaseClient } from "@supabase/supabase-js";

export type JourneyType = {
  id: string;
  name: string;
  step_confirm_info: boolean;
  step_sign_agreement: boolean;
  step_payment: boolean;
  step_app_onboarding: boolean;
  step_book_meeting: boolean;
  step_planner: boolean;
  agreement_template_id: string | null;
  calendar_embed: string | null;
  final_page_heading: string | null;
  final_page_body: string | null;
};

/** The implicit journey for events with no journey_type_id: the full standard
    flow, no partner-specific bits. Mirrors the seeded "Direct" row. */
export const DEFAULT_JOURNEY: JourneyType = {
  id: "",
  name: "Direct",
  step_confirm_info: true,
  step_sign_agreement: true,
  step_payment: true,
  step_app_onboarding: false,
  step_book_meeting: false,
  step_planner: true,
  agreement_template_id: null,
  calendar_embed: null,
  final_page_heading: null,
  final_page_body: null,
};

export async function loadEventJourney(
  supabase: SupabaseClient,
  journeyTypeId: string | null | undefined,
): Promise<JourneyType> {
  if (!journeyTypeId) return DEFAULT_JOURNEY;
  const { data } = await supabase
    .from("journey_types")
    .select(
      "id, name, step_confirm_info, step_sign_agreement, step_payment, step_app_onboarding, step_book_meeting, step_planner, agreement_template_id, calendar_embed, final_page_heading, final_page_body",
    )
    .eq("id", journeyTypeId)
    .maybeSingle();
  return (data as JourneyType) ?? DEFAULT_JOURNEY;
}
