/* Mirrors the RLS in supabase/migrations/00213_event_join_links.sql.
   Permissive policies are OR. Restrictive policies are AND. A row is visible
   only when at least one permissive policy passes and every restrictive
   policy passes. */

export type MoneyActor = {
  staff: boolean;
  /** xos_is_host for this event. Staff count as hosts in the database. */
  hostOfEvent: boolean;
  marketing: boolean;
};

export type MoneyPolicy = {
  kind: "permissive" | "restrictive";
  allow: (actor: MoneyActor, hidden: boolean) => boolean;
};

/** Policies 00213 leaves on payments, scheduled_payments, and event_addons. */
export function moneyPoliciesAfter00213(): MoneyPolicy[] {
  return [
    {
      kind: "permissive",
      allow: (actor) => actor.staff,
    },
    {
      kind: "permissive",
      allow: (actor) => actor.hostOfEvent,
    },
    {
      kind: "restrictive",
      allow: (actor, hidden) => actor.staff || (actor.hostOfEvent && !hidden),
    },
    {
      kind: "restrictive",
      allow: (actor) => !actor.marketing,
    },
  ];
}

/**
 * The live 00199 expression, if it were a permissive policy instead of
 * restrictive. `staff OR NOT hidden` would then grant every non-hidden row
 * to any authenticated user.
 */
export function moneyPoliciesIfHideWerePermissive(): MoneyPolicy[] {
  return [
    { kind: "permissive", allow: (actor) => actor.staff || actor.hostOfEvent },
    { kind: "permissive", allow: (actor, hidden) => actor.staff || !hidden },
  ];
}

export function rowVisible(policies: MoneyPolicy[], actor: MoneyActor, hidden: boolean): boolean {
  const permissive = policies.filter((policy) => policy.kind === "permissive");
  const restrictive = policies.filter((policy) => policy.kind === "restrictive");
  const passedPermissive = permissive.some((policy) => policy.allow(actor, hidden));
  const passedRestrictive = restrictive.every((policy) => policy.allow(actor, hidden));
  return passedPermissive && passedRestrictive;
}

export type SectionRow = {
  id: string;
  event_id: string;
  title: string;
  sort_order: number;
  guest_enabled: boolean;
  client_editable: boolean;
  locked: boolean;
  client_notes: string | null;
};

export type SectionActor = "staff" | "service" | "host" | "guest";

/** Non-staff, including guests and hosts, may change client_notes only. */
export function sectionUpdateAllowed(actor: SectionActor, before: SectionRow, after: SectionRow): "ok" | "forbidden" {
  if (actor === "staff" || actor === "service") return "ok";
  const frozen: Array<keyof SectionRow> = [
    "id",
    "event_id",
    "title",
    "sort_order",
    "guest_enabled",
    "client_editable",
    "locked",
  ];
  for (const key of frozen) {
    if (before[key] !== after[key]) return "forbidden";
  }
  return "ok";
}

export type SongIdentity = {
  id: string;
  event_id: string;
  section_id: string;
  requested_by: string;
};

/** Guests cannot point a song at a different event, section, or author. */
export function guestSongMoveAllowed(before: SongIdentity, after: SongIdentity): "ok" | "forbidden" {
  if (
    before.id !== after.id ||
    before.event_id !== after.event_id ||
    before.section_id !== after.section_id ||
    before.requested_by !== after.requested_by
  ) {
    return "forbidden";
  }
  return "ok";
}

const EVENT_FOLDER = /^[0-9a-fA-F-]{36}$/;

/** Host read of event-files is the first path segment, and only when it is that event. */
export function canReadEventFile(actor: { staff: boolean; hostOf: ReadonlySet<string> }, objectPath: string): boolean {
  if (actor.staff) return true;
  const folder = objectPath.split("/")[0] ?? "";
  if (!EVENT_FOLDER.test(folder)) return false;
  return actor.hostOf.has(folder);
}
