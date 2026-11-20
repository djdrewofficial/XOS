/**
 * Client profile / list helpers: a person may be linked to an event as
 * `events.client_id` (primary) and/or via the `event_clients` join table
 * (co-client, contract holder, planner, etc.). Callers fetch both and merge.
 */

export type ClientEventLinkRow<T> = {
  role?: string | null;
  event: T | null;
};

export type WithClientRole<T> = T & { client_role?: string | null };

type EventLike = {
  id: string;
  event_date?: string | null;
  archived_at?: string | null;
};

/**
 * Union primary events with event_clients-linked events, de-duplicated by id.
 * When both sources have the same event, the join-table `role` wins when set.
 * Sorted by event_date descending (null dates last) — same order the profile
 * page's `.order("event_date", { ascending: false })` aims for.
 */
export function mergeClientEvents<T extends EventLike>(
  primary: readonly T[] | null | undefined,
  links: readonly ClientEventLinkRow<T>[] | null | undefined,
  opts?: { excludeArchived?: boolean },
): WithClientRole<T>[] {
  const excludeArchived = opts?.excludeArchived ?? false;
  const byId = new Map<string, WithClientRole<T>>();

  for (const e of primary ?? []) {
    if (excludeArchived && e.archived_at) continue;
    byId.set(e.id, { ...e, client_role: null });
  }

  for (const row of links ?? []) {
    const e = row.event;
    if (!e) continue;
    if (excludeArchived && e.archived_at) continue;
    const role = row.role ?? null;
    const existing = byId.get(e.id);
    if (existing) {
      if (role) existing.client_role = role;
    } else {
      byId.set(e.id, { ...e, client_role: role });
    }
  }

  return [...byId.values()].sort((a, b) => compareEventDateDesc(a.event_date, b.event_date));
}

/** Newer dates first; missing dates sort last. */
export function compareEventDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  const da = a ?? "";
  const db = b ?? "";
  if (da === db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}
