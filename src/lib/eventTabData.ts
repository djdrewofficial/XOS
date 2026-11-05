/**
 * Which open event-page tab should load each dataset.
 *
 * The event page skips a query unless this tab is open. The tab is the one
 * that renders the control. Planning templates and the Spotify export render
 * on Details. The add-on catalog, package list, and trip tracker render on
 * Financials. The event log renders on Booking.
 */
export const EVENT_DATASET_TAB = {
  eventLog: "booking",
  addonCatalog: "financials",
  packages: "financials",
  trips: "financials",
  vehicles: "financials",
  planningTemplates: "details",
  spotify: "details",
  plannerTimeline: "details",
} as const;

export type EventDataset = keyof typeof EVENT_DATASET_TAB;

export function loadsOnTab(activeTab: string, dataset: EventDataset): boolean {
  return EVENT_DATASET_TAB[dataset] === activeTab;
}
