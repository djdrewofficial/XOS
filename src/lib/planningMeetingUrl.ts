/* Planning-meeting merge tags (<poc_planning_link>, <dj_calendar_link>).
   SQL mirror: xos_default_planning_meeting_url / xos_event_planning_meeting_url
   in migration 00227. Keep the fallback URL identical in both places. */

/** Company booking link used when the assigned DJ has no planning_meeting_url. */
export const DEFAULT_PLANNING_MEETING_URL = "https://xpressdjs.com/drewplanning/";

/** DJ profile URL when present; otherwise the company fallback. Never blank. */
export function resolvePlanningMeetingUrl(
  planningMeetingUrl: string | null | undefined,
): string {
  const trimmed = (planningMeetingUrl ?? "").trim();
  return trimmed || DEFAULT_PLANNING_MEETING_URL;
}
