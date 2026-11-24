/* Apply booking-helper Demo Mode / Send App Demo actions in TypeScript.
   The SQL engine records them as deferred; enable/disable and messaging live
   here so we call the same enableEventDemoMode / disableEventDemoMode paths. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoDisableMode } from "@/lib/demoModeLogic";

export type DemoHelperAction = {
  type?: string;
  mode?: string;
  force?: boolean | string;
};

export function parseDemoDisableMode(raw: string | null | undefined): DemoDisableMode {
  return raw === "clean_slate" ? "clean_slate" : "keep_client";
}

export function helperHasDemoModeOn(actions: DemoHelperAction[]): boolean {
  return actions.some((a) => a.type === "demo_mode_on" || a.type === "send_app_demo");
}

export function helperHasDemoModeOff(actions: DemoHelperAction[]): boolean {
  return actions.some((a) => a.type === "demo_mode_off");
}

export function helperHasSendAppDemo(actions: DemoHelperAction[]): boolean {
  return actions.some((a) => a.type === "send_app_demo");
}

/** Run demo_mode_on / send_app_demo (enable) before the SQL helper engine queues mail. */
export async function applyDemoModeHelperActionsBefore(
  _admin: SupabaseClient,
  eventId: string,
  actions: DemoHelperAction[],
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const { enableEventDemoMode } = await import("@/lib/demoMode");
  const { sendAppDemo } = await import("@/lib/sendAppDemo");

  for (const act of actions) {
    if (act.type === "send_app_demo") {
      // Full composite: enable + email/SMS. Skip separate demo_mode_on if both present.
      const result = await sendAppDemo(eventId, {
        force: act.force === true || act.force === "true",
        drain: false,
      });
      if (!result.ok) warnings.push(result.error);
      else if (result.warnings?.length) warnings.push(...result.warnings);
      continue;
    }
    if (act.type === "demo_mode_on") {
      if (helperHasSendAppDemo(actions)) continue; // already handled by send_app_demo
      const result = await enableEventDemoMode(eventId, {
        force: act.force === true || act.force === "true",
      });
      if (!result.ok) warnings.push(result.error);
    }
  }
  return { warnings };
}

/** Run demo_mode_off after the SQL helper engine (e.g. After Sign). */
export async function applyDemoModeHelperActionsAfter(
  _admin: SupabaseClient,
  eventId: string,
  actions: DemoHelperAction[],
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const { disableEventDemoMode } = await import("@/lib/demoMode");

  for (const act of actions) {
    if (act.type !== "demo_mode_off") continue;
    const mode = parseDemoDisableMode(act.mode);
    const result = await disableEventDemoMode(eventId, mode);
    // NOT_DEMO is fine when the event was never in demo.
    if (!result.ok && result.code !== "NOT_DEMO") warnings.push(result.error);
  }
  return { warnings };
}
