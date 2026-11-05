import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EVENT_DATASET_TAB, loadsOnTab } from "./eventTabData.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(root, "src/app/(app)/events/[id]/page.tsx"), "utf8");

describe("event tab datasets", () => {
  it("loads planner templates and Spotify on Details, not Notes", () => {
    assert.equal(EVENT_DATASET_TAB.planningTemplates, "details");
    assert.equal(EVENT_DATASET_TAB.spotify, "details");
    assert.equal(EVENT_DATASET_TAB.plannerTimeline, "details");
    assert.equal(loadsOnTab("details", "planningTemplates"), true);
    assert.equal(loadsOnTab("notes", "planningTemplates"), false);
    assert.equal(loadsOnTab("notes", "spotify"), false);
  });

  it("loads the add-on catalog, packages, and trips on Financials", () => {
    assert.equal(EVENT_DATASET_TAB.addonCatalog, "financials");
    assert.equal(EVENT_DATASET_TAB.packages, "financials");
    assert.equal(EVENT_DATASET_TAB.trips, "financials");
    assert.equal(EVENT_DATASET_TAB.vehicles, "financials");
    assert.equal(loadsOnTab("financials", "addonCatalog"), true);
    assert.equal(loadsOnTab("booking", "addonCatalog"), false);
    assert.equal(loadsOnTab("logistics", "trips"), false);
  });

  it("loads the event log on Booking", () => {
    assert.equal(EVENT_DATASET_TAB.eventLog, "booking");
    assert.equal(loadsOnTab("booking", "eventLog"), true);
    assert.equal(loadsOnTab("details", "eventLog"), false);
  });

  it("gates the event-page queries with those datasets", () => {
    assert.match(page, /loadsOnTab\(activeTab, "planningTemplates"\)[\s\S]{0,180}from\("planning_templates"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "spotify"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "plannerTimeline"\)[\s\S]{0,280}from\("planning_sections"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "addonCatalog"\)[\s\S]{0,180}from\("addons"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "packages"\)[\s\S]{0,180}from\("packages"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "trips"\)[\s\S]{0,220}from\("event_trips"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "vehicles"\)[\s\S]{0,160}from\("vehicles"\)/);
    assert.match(page, /loadsOnTab\(activeTab, "eventLog"\)[\s\S]{0,180}from\("event_logs"\)/);
    assert.doesNotMatch(page, /want\("notes"\)[\s\S]{0,80}from\("planning_templates"\)/);
    assert.doesNotMatch(page, /want\("booking"\)[\s\S]{0,80}from\("addons"\)/);
    assert.doesNotMatch(page, /want\("booking"\)[\s\S]{0,120}from\("packages"\)/);
  });
});
