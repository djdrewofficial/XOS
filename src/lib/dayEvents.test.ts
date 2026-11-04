import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dayEventCardModel,
  formatDayHeading,
  formatEventTime,
  otherEventsOnDay,
  selectionAfterDayClick,
  selectionAfterEventClick,
  sortDayEvents,
  type CalDetailedEvent,
} from "./dayEvents.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function event(partial: Partial<CalDetailedEvent> & Pick<CalDetailedEvent, "id">): CalDetailedEvent {
  return {
    name: null,
    start_time: null,
    end_time: null,
    status: null,
    client: null,
    venue: null,
    package_name: null,
    event_type_name: null,
    addons: [],
    staff: [],
    ...partial,
  };
}

describe("calendar event pill clicks", () => {
  const none = { date: null, eventId: null };

  it("selects the event on the first click and does not navigate", () => {
    const result = selectionAfterEventClick(none, { id: "ev-a", date: "2026-11-07" });
    assert.deepEqual(result.selection, { date: "2026-11-07", eventId: "ev-a" });
    assert.equal(result.navigateTo, null);
  });

  it("navigates when the same already-selected event is clicked again", () => {
    const selected = { date: "2026-11-07", eventId: "ev-a" };
    const result = selectionAfterEventClick(selected, { id: "ev-a", date: "2026-11-07" });
    assert.equal(result.navigateTo, "/events/ev-a");
    assert.deepEqual(result.selection, selected);
  });

  it("selects a different event on the open day instead of navigating", () => {
    const result = selectionAfterEventClick(
      { date: "2026-11-07", eventId: "ev-a" },
      { id: "ev-b", date: "2026-11-07" },
    );
    assert.equal(result.navigateTo, null);
    assert.deepEqual(result.selection, { date: "2026-11-07", eventId: "ev-b" });
  });

  it("treats the same event on a newly opened day as a first click", () => {
    const result = selectionAfterEventClick(
      { date: "2026-11-08", eventId: "ev-a" },
      { id: "ev-a", date: "2026-11-07" },
    );
    assert.equal(result.navigateTo, null);
    assert.deepEqual(result.selection, { date: "2026-11-07", eventId: "ev-a" });
  });

  it("opens the day panel from a day click without selecting an event", () => {
    assert.deepEqual(selectionAfterDayClick("2026-11-07"), { date: "2026-11-07", eventId: null });
  });

  it("needs a fresh selection after a day click before a pill navigates", () => {
    const day = selectionAfterDayClick("2026-11-07");
    const first = selectionAfterEventClick(day, { id: "ev-a", date: "2026-11-07" });
    assert.equal(first.navigateTo, null);
    const second = selectionAfterEventClick(first.selection, { id: "ev-a", date: "2026-11-07" });
    assert.equal(second.navigateTo, "/events/ev-a");
  });
});

describe("day event cards", () => {
  const full = event({
    id: "ev-1",
    name: "Stephanie & Davide's Wedding",
    start_time: "16:30:00",
    end_time: "23:00:00",
    status: { name: "Booked EV", color: "#97CC9A", text_color: "#000000" },
    client: { first_name: "Stephanie", last_name: "Miles", cell_phone: "305-555-0100" },
    venue: { name: "Villa Toscana Miami", city: "Homestead", state: "FL" },
    package_name: "Toscana Xpress Package",
    event_type_name: "Wedding",
    addons: [{ name: "LED Dance Floor", quantity: 1 }],
    staff: [{ name: "Drew", role: "DJ" }],
  });

  it("keeps every detail the expanded day row showed, plus event type", () => {
    const card = dayEventCardModel(full);
    assert.equal(card.title, "Stephanie Miles");
    assert.equal(card.href, "/events/ev-1");
    assert.equal(card.startLabel, formatEventTime("16:30:00"));
    assert.equal(card.status?.name, "Booked EV");
    assert.deepEqual(
      card.rows.map((r) => r.label),
      ["Start / End", "Client", "Venue", "Status", "Event Name", "Type", "Cell Phone", "Package"],
    );
    const value = (label: string) => card.rows.find((r) => r.label === label)?.value;
    assert.equal(value("Client"), "Stephanie Miles");
    assert.equal(value("Venue"), "Villa Toscana Miami — Homestead, FL");
    assert.equal(value("Status"), "Booked EV");
    assert.equal(value("Event Name"), "Stephanie & Davide's Wedding");
    assert.equal(value("Type"), "Wedding");
    assert.equal(value("Cell Phone"), "305-555-0100");
    assert.equal(value("Package"), "Toscana Xpress Package");
    assert.match(value("Start / End") ?? "", /–/);
    assert.deepEqual(card.addons, [{ name: "LED Dance Floor", quantity: 1 }]);
    assert.deepEqual(card.staff, [{ name: "Drew", role: "DJ" }]);
  });

  it("omits empty details and falls back to the event name", () => {
    const card = dayEventCardModel(event({ id: "ev-2", name: "Corporate Mixer" }));
    assert.equal(card.title, "Corporate Mixer");
    assert.deepEqual(card.rows, [{ label: "Event Name", value: "Corporate Mixer" }]);
    assert.equal(card.startLabel, null);
    const bare = dayEventCardModel(event({ id: "ev-3" }));
    assert.equal(bare.title, "Event");
    assert.deepEqual(bare.rows, []);
  });

  it("sorts a day by start time with unset times last", () => {
    const sorted = sortDayEvents([
      event({ id: "c", start_time: null }),
      event({ id: "b", start_time: "16:00:00" }),
      event({ id: "a", start_time: "16:30:00" }),
    ]);
    assert.deepEqual(sorted.map((e) => e.id), ["b", "a", "c"]);
  });

  it("formats the day heading the panel uses", () => {
    assert.equal(formatDayHeading("2026-11-07"), "Saturday, November 7, 2026");
  });

  it("treats every other event on the date as a sibling of the one being viewed", () => {
    const events = [event({ id: "here" }), event({ id: "other" })];
    assert.deepEqual(otherEventsOnDay(events, "here").map((e) => e.id), ["other"]);
    assert.equal(otherEventsOnDay([event({ id: "here" })], "here").length, 0);
  });
});

describe("shared day-cards component", () => {
  const calendar = readFileSync(join(root, "src/components/dashboard/MonthCalendarClient.tsx"), "utf8");
  const badge = readFileSync(join(root, "src/components/EventDateBadge.tsx"), "utf8");
  const cards = readFileSync(join(root, "src/components/dashboard/DayEventCards.tsx"), "utf8");
  const loader = readFileSync(join(root, "src/lib/calendarEvents.ts"), "utf8");

  it("renders one DayEventCards component from the calendar and the date badge", () => {
    assert.match(calendar, /from "@\/components\/dashboard\/DayEventCards"/);
    assert.match(badge, /from "@\/components\/dashboard\/DayEventCards"/);
    assert.match(cards, /Open event/);
    assert.match(cards, /This event/);
    assert.match(calendar, /selectionAfterEventClick/);
    assert.match(calendar, /stopPropagation/);
    assert.match(badge, /Escape/);
    // The event header is backdrop-blur, which would trap a fixed popover.
    assert.match(badge, /createPortal/);
  });

  it("loads day cards with the calendar's archived-event filter", () => {
    assert.match(loader, /\.is\("archived_at", null\)/);
    assert.match(readFileSync(join(root, "src/app/(app)/events/[id]/page.tsx"), "utf8"), /loadEventsByDate/);
  });
});
