/* Pure Demo Mode helpers (no DB / no server-only). Safe for unit tests. */

export type DemoDisableMode = "clean_slate" | "keep_client";

export type RealPlanningSnapshot = {
  nonDemoAnswers: number;
  nonDemoSongs: number;
  nonDemoSongIdeas: number;
  clientNotes: number;
  doNotPlayNotes: boolean;
};

export function hasRealPlanningData(snap: RealPlanningSnapshot): boolean {
  return (
    snap.nonDemoAnswers > 0 ||
    snap.nonDemoSongs > 0 ||
    snap.nonDemoSongIdeas > 0 ||
    snap.clientNotes > 0 ||
    snap.doNotPlayNotes
  );
}

/** Answers touched after demo was enabled count as client entries (keep mode). */
export function isClientEditedDemoAnswer(args: {
  isDemo: boolean;
  updatedAt: string | null;
  demoEnabledAt: string | null;
  /** Grace window so the seed's own updated_at doesn't look like a client edit. */
  graceMs?: number;
}): boolean {
  if (!args.isDemo) return true;
  if (!args.demoEnabledAt || !args.updatedAt) return false;
  const grace = args.graceMs ?? 2000;
  return Date.parse(args.updatedAt) > Date.parse(args.demoEnabledAt) + grace;
}

/** Decide enable outcome without hitting the DB. */
export function decideEnableDemoMode(args: {
  demoMode: boolean;
  existingDemoSections: number;
  real: RealPlanningSnapshot;
  force?: boolean;
}): "already" | "repair" | "refuse_real_data" | "seed" {
  if (args.demoMode) return args.existingDemoSections > 0 ? "already" : "repair";
  if (hasRealPlanningData(args.real) && !args.force) return "refuse_real_data";
  return "seed";
}

/** Fields Demo Mode must never mutate as a side effect. */
export const DEMO_MODE_PRESERVED_EVENT_FIELDS = ["hide_financials", "comms_paused"] as const;

export function preservedEventFlags<T extends { hide_financials?: unknown; comms_paused?: unknown }>(
  before: T,
): Pick<T, "hide_financials" | "comms_paused"> {
  return {
    hide_financials: before.hide_financials,
    comms_paused: before.comms_paused,
  };
}
