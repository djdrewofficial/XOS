import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEMO_MODE_PRESERVED_EVENT_FIELDS,
  decideEnableDemoMode,
  hasRealPlanningData,
  isClientEditedDemoAnswer,
  preservedEventFlags,
} from "./demoModeLogic.ts";
import {
  DEMO_DO_NOT_PLAY_NOTES,
  DEMO_QUESTIONS,
  DEMO_SECTIONS,
  DEMO_SONG_IDEAS,
  DEMO_SONGS,
} from "./demoModeSeed.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const emptyReal = {
  nonDemoAnswers: 0,
  nonDemoSongs: 0,
  nonDemoSongIdeas: 0,
  clientNotes: 0,
  doNotPlayNotes: false,
};

describe("demo mode seed dataset", () => {
  it("matches the Apple Review demo shape (8 headlines, 17 moments, 28 questions, ~22 answers, songs, ideas)", () => {
    const headlines = DEMO_SECTIONS.filter((s) => s.section_type === "headline");
    const moments = DEMO_SECTIONS.filter((s) => s.section_type !== "headline");
    const answers = DEMO_QUESTIONS.filter((q) => q.answer != null && String(q.answer).trim() !== "");
    assert.equal(headlines.length, 8);
    assert.equal(moments.length, 17);
    assert.equal(DEMO_QUESTIONS.length, 28);
    assert.equal(answers.length, 22);
    assert.ok(DEMO_SONGS.length >= 27);
    assert.equal(DEMO_SONG_IDEAS.length, 4);
    assert.ok(DEMO_DO_NOT_PLAY_NOTES.length > 10);
  });

  it("references only known section keys and uses unique keys", () => {
    const sectionKeys = new Set(DEMO_SECTIONS.map((s) => s.key));
    assert.equal(sectionKeys.size, DEMO_SECTIONS.length);
    const qKeys = new Set(DEMO_QUESTIONS.map((q) => q.key));
    assert.equal(qKeys.size, DEMO_QUESTIONS.length);
    const sKeys = new Set(DEMO_SONGS.map((s) => s.key));
    assert.equal(sKeys.size, DEMO_SONGS.length);
    for (const q of DEMO_QUESTIONS) assert.ok(sectionKeys.has(q.sectionKey), q.key);
    for (const s of DEMO_SONGS) assert.ok(sectionKeys.has(s.sectionKey), s.key);
  });

  it("does not embed the hardcoded Apple Review UUIDs", () => {
    const blob = JSON.stringify({ DEMO_SECTIONS, DEMO_QUESTIONS, DEMO_SONGS, DEMO_SONG_IDEAS });
    assert.doesNotMatch(blob, /a0a0a0a0-0000-4000-8000/);
  });
});

describe("demo mode enable decisions", () => {
  it("is idempotent when demo mode is already on with sections", () => {
    assert.equal(
      decideEnableDemoMode({ demoMode: true, existingDemoSections: 25, real: emptyReal }),
      "already",
    );
  });

  it("repairs an empty demo_mode event instead of no-oping forever", () => {
    assert.equal(
      decideEnableDemoMode({ demoMode: true, existingDemoSections: 0, real: emptyReal }),
      "repair",
    );
  });

  it("refuses to overwrite real client planning data without force", () => {
    assert.equal(
      decideEnableDemoMode({
        demoMode: false,
        existingDemoSections: 0,
        real: { ...emptyReal, nonDemoAnswers: 3 },
      }),
      "refuse_real_data",
    );
    assert.equal(
      decideEnableDemoMode({
        demoMode: false,
        existingDemoSections: 0,
        real: { ...emptyReal, nonDemoSongs: 1 },
      }),
      "refuse_real_data",
    );
    assert.equal(
      decideEnableDemoMode({
        demoMode: false,
        existingDemoSections: 0,
        real: { ...emptyReal, clientNotes: 1 },
        force: true,
      }),
      "seed",
    );
  });

  it("seeds when the event has no real planning work", () => {
    assert.equal(
      decideEnableDemoMode({ demoMode: false, existingDemoSections: 0, real: emptyReal }),
      "seed",
    );
  });
});

describe("demo mode keep-client answer edits", () => {
  it("treats answers updated after enable as client entries", () => {
    const enabledAt = "2026-11-23T12:00:00.000Z";
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: "2026-11-23T12:00:01.000Z",
        demoEnabledAt: enabledAt,
      }),
      false,
    );
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: "2026-11-23T12:05:00.000Z",
        demoEnabledAt: enabledAt,
      }),
      true,
    );
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: false,
        updatedAt: "2026-11-23T12:00:00.000Z",
        demoEnabledAt: enabledAt,
      }),
      true,
    );
  });
});

describe("demo mode never mutates pricing/comms flags", () => {
  it("preserves hide_financials and comms_paused", () => {
    assert.deepEqual(DEMO_MODE_PRESERVED_EVENT_FIELDS, ["hide_financials", "comms_paused"]);
    assert.deepEqual(
      preservedEventFlags({ hide_financials: false, comms_paused: true, demo_mode: false }),
      { hide_financials: false, comms_paused: true },
    );
    assert.deepEqual(
      preservedEventFlags({ hide_financials: true, comms_paused: false }),
      { hide_financials: true, comms_paused: false },
    );
  });

  it("hasRealPlanningData is false for an empty snapshot", () => {
    assert.equal(hasRealPlanningData(emptyReal), false);
  });
});

describe("demo mode wiring", () => {
  it("ships migration 00239 with demo_mode, is_demo markers, and field-staff view update", () => {
    const mig = read("supabase/migrations/00239_event_demo_mode.sql");
    assert.match(mig, /add column if not exists demo_mode boolean not null default false/);
    assert.match(mig, /demo_mode_enabled_at/);
    assert.match(mig, /planning_sections[\s\S]*is_demo/);
    assert.match(mig, /planning_songs[\s\S]*is_demo/);
    assert.match(mig, /planning_question_answers[\s\S]*is_demo/);
    assert.match(mig, /song_ideas[\s\S]*is_demo/);
    assert.match(mig, /xos_fs_events/);
    assert.match(mig, /e\.demo_mode/);
    assert.doesNotMatch(mig, /hide_financials\s*=/);
    assert.doesNotMatch(mig, /comms_paused\s*=/);
  });

  it("reseedEventPlanning exits Demo Mode when a real template is assigned", () => {
    const planning = read("src/lib/planning.ts");
    assert.match(planning, /demo_mode:\s*false/);
    assert.match(planning, /demo_mode_enabled_at:\s*null/);
  });

  it("exposes demo_mode on events_get and a safe set tool with no outbound comms", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    assert.match(office, /demo_mode/);
    assert.match(office, /events_set_demo_mode/);
    assert.match(office, /enableEventDemoMode/);
    assert.match(office, /disableEventDemoMode/);
    const toolBlock = office.slice(office.indexOf('name: "events_set_demo_mode"'), office.indexOf('name: "events_archive"'));
    assert.match(toolBlock, /Never sends email or SMS/i);
    assert.doesNotMatch(toolBlock, /processOutbox|processSmsOutbox|sendDirectSms|queueTemplate/);
  });

  it("demo mode lib never queues email or SMS and preserves financial/comms flags", () => {
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /hide_financials: preserved\.hide_financials/);
    assert.match(lib, /comms_paused: preserved\.comms_paused/);
    assert.doesNotMatch(lib, /processOutbox|processSmsOutbox|sendDirectSms|queueTemplate|runAutomations/);
    assert.match(lib, /is_demo:\s*true/);
    assert.match(lib, /wipeEventPlanning/);
    assert.match(lib, /clean_slate/);
    assert.match(lib, /keep_client/);
    assert.match(lib, /ensureEventPlanning/);
    // Soft-hidden demo songs are hard-deleted on disable (service role).
    assert.match(lib, /from\("planning_songs"\)\.delete\(\)/);
  });

  it("UI control lives on the event page near app access", () => {
    const page = read("src/app/(app)/events/[id]/page.tsx");
    assert.match(page, /EventDemoMode/);
    assert.match(page, /DemoModeBanner/);
    assert.match(page, /demoMode/);
    const actions = read("src/app/(app)/events/demoModeActions.ts");
    assert.match(actions, /enableEventDemoMode/);
    assert.match(actions, /disableEventDemoMode/);
    assert.doesNotMatch(actions, /processOutbox|sendAccountInvite|emailAppJoinCode/);
  });

  it("field staff view column list includes demo_mode", () => {
    const src = read("src/lib/eventSource.ts");
    assert.match(src, /"demo_mode"/);
    assert.match(src, /"demo_mode_enabled_at"/);
  });
});

describe("demo mode keep vs clean slate intent", () => {
  it("documents both disable paths in the server lib", () => {
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /Remove sample data only|keep_client/);
    assert.match(lib, /isClientEditedDemoAnswer/);
    assert.match(lib, /removeDemoLeavesOnly/);
    // Clean slate clears planning_seeded then re-seeds blank template.
    assert.match(lib, /planning_seeded:\s*false/);
    assert.match(lib, /ensureEventPlanning\(eventId/);
  });
});
