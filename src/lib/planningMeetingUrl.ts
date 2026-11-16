/* Planning-meeting merge tags.
   <poc_planning_link> (We're Alive 6 / 30-day email) historically reads
   employees.planning_meeting_url on events.point_of_contact_employee_id.
   <dj_calendar_link> reads the assigned DJ's employees.planning_meeting_url.
   SQL mirror: xos_default_planning_meeting_url / xos_dj_planning_meeting_url /
   xos_event_planning_meeting_url in migration 00227. Keep the fallback URL
   identical in SQL and here. */

/** Company booking link when POC and DJ planning URLs are both empty. */
export const DEFAULT_PLANNING_MEETING_URL = "https://xpressdjs.com/drewplanning/";

/** First non-empty candidate, else the company fallback. Never blank. */
export function resolvePlanningMeetingUrl(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim();
    if (trimmed) return trimmed;
  }
  return DEFAULT_PLANNING_MEETING_URL;
}
