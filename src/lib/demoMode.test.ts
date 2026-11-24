import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEMO_MODE_PRESERVED_EVENT_FIELDS,
  decideEnableDemoMode,
  demoSongIdeaListFate,
  hasRealPlanningData,
  isClientEditedDemoAnswer,
  preservedEventFlags,
} from "./demoModeLogic.ts";
import {
  assignDemoSongsToSections,
  demoAnswerForQuestion,
  demoSongRoleForSectionTitle,
  PREFERRED_DEMO_TEMPLATE_ID,
  PREFERRED_DEMO_TEMPLATE_NAME,
} from "./demoModeAnswers.ts";
import { DEMO_DO_NOT_PLAY_NOTES, DEMO_SONG_IDEAS, DEMO_SONGS } from "./demoModeSeed.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const emptyReal = {
  nonDemoAnswers: 0,
  nonDemoSongs: 0,
  nonDemoSongIdeas: 0,
  clientNotes: 0,
  doNotPlayNotes: false,
};

describe("demo mode music catalog", () => {
  it("keeps a rich song + idea catalog with unique keys", () => {
    assert.ok(DEMO_SONGS.length >= 27);
    assert.equal(DEMO_SONG_IDEAS.length, 4);
    assert.ok(DEMO_DO_NOT_PLAY_NOTES.length > 10);
    const sKeys = new Set(DEMO_SONGS.map((s) => s.key));
    assert.equal(sKeys.size, DEMO_SONGS.length);
    const iKeys = new Set(DEMO_SONG_IDEAS.map((s) => s.key));
    assert.equal(iKeys.size, DEMO_SONG_IDEAS.length);
  });

  it("does not embed the hardcoded Apple Review UUIDs", () => {
    const blob = JSON.stringify({ DEMO_SONGS, DEMO_SONG_IDEAS });
    assert.doesNotMatch(blob, /a0a0a0a0-0000-4000-8000/);
  });

  it("no longer ships a hardcoded section/question tree", () => {
    const seed = read("src/lib/demoModeSeed.ts");
    assert.doesNotMatch(seed, /export const DEMO_SECTIONS/);
    assert.doesNotMatch(seed, /export const DEMO_QUESTIONS/);
    assert.doesNotMatch(seed, /Getting Ready Playlist/);
    assert.doesNotMatch(seed, /Let's get started!/);
  });
});

describe("demo answer generation for template questions", () => {
  it("fills common Wedding 2026-style prompts by type", () => {
    assert.equal(
      demoAnswerForQuestion({ prompt: "How many guests are you expecting?", answer_type: "short" }),
      "120",
    );
    assert.equal(
      demoAnswerForQuestion({ prompt: "What is your wedding color palette or theme?", answer_type: "short" }),
      "Sage green and gold, garden theme",
    );
    assert.equal(
      demoAnswerForQuestion({ prompt: "On a scale of 1 to 10, how much does your crowd like to party?", answer_type: "scale" }),
      "8",
    );
    assert.equal(
      demoAnswerForQuestion({ prompt: "Are you having a Father-Daughter Dance?", answer_type: "yesno" }),
      "yes",
    );
    assert.equal(
      demoAnswerForQuestion({
        prompt: "How will dinner be served?",
        answer_type: "select",
        options: ["Buffet", "Plated", "Family Style"],
      }),
      "Plated",
    );
    assert.equal(
      demoAnswerForQuestion({
        prompt: "Which cocktail hour vibes fit your crowd? Select all that apply.",
        answer_type: "multiselect",
        options: ["Classy & Cool", "Acoustic & Chill", "Soulful & Smooth", "Upbeat & Fun Pop"],
      }),
      "Classy & Cool|Soulful & Smooth",
    );
    assert.equal(
      demoAnswerForQuestion({
        prompt: "Would you like the entire song played or a fade out?",
        answer_type: "select",
        options: ["Entire song", "Fade out when appropriate", "Custom edit (explain in notes)"],
      }),
      "Fade out when appropriate",
    );
  });

  it("picks image_select labels from object options", () => {
    assert.equal(
      demoAnswerForQuestion({
        prompt: "Pick a backdrop",
        answer_type: "image_select",
        options: [{ label: "Floral Arch", image: "x.jpg" }, { label: "Neon Love" }],
      }),
      "Floral Arch",
    );
  });
});

describe("demo song placement onto template sections", () => {
  it("maps Wedding 2026 section titles to catalog roles", () => {
    assert.equal(demoSongRoleForSectionTitle("Ceremony Prelude (Guest Arrival)"), "tl-seating");
    assert.equal(demoSongRoleForSectionTitle("Processional - Bride"), "tl-bridal");
    assert.equal(demoSongRoleForSectionTitle("First Dance"), "tl-first-dance");
    assert.equal(demoSongRoleForSectionTitle("Father-Daughter Dance"), "tl-father-daughter");
    assert.equal(demoSongRoleForSectionTitle("Must Play Songs"), "must-play");
    assert.equal(demoSongRoleForSectionTitle("Don't Play"), "dont-play");
    assert.equal(demoSongRoleForSectionTitle("Dance Floor Suggestions"), "tl-open");
  });

  it("assigns songs into music sections and respects song_limit", () => {
    const sections = [
      { id: "s1", title: "First Dance", songs_enabled: true, song_limit: 1 },
      { id: "s2", title: "Don't Play", songs_enabled: true, song_limit: null },
      { id: "s3", title: "Let's Plan", songs_enabled: false, song_limit: null },
      { id: "s4", title: "Must Play Songs", songs_enabled: true, song_limit: 3 },
    ];
    const placed = assignDemoSongsToSections(sections, DEMO_SONGS);
    assert.ok(placed.some((p) => p.section_id === "s1"));
    assert.equal(placed.filter((p) => p.section_id === "s1").length, 1);
    assert.ok(placed.filter((p) => p.section_id === "s2").every((p) => p.song.do_not_play));
    assert.ok(placed.filter((p) => p.section_id === "s4").every((p) => p.song.must_play));
    assert.ok(!placed.some((p) => p.section_id === "s3"));
    // No duplicate catalog keys across sections.
    const keys = placed.map((p) => p.song.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("demo mode enable decisions", () => {
  it("is idempotent when demo mode is already on with sections", () => {
    assert.equal(
      decideEnableDemoMode({ demoMode: true, existingDemoSections: 25, real: emptyReal }),
      "already",
    );
  });

  it("force reseeds even when demo mode is already on", () => {
    assert.equal(
      decideEnableDemoMode({ demoMode: true, existingDemoSections: 25, real: emptyReal, force: true }),
      "seed",
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
  it("treats a non-null author id as a client edit immediately", () => {
    const enabledAt = "2026-11-23T12:00:00.000Z";
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: "2026-11-23T12:00:00.500Z",
        demoEnabledAt: enabledAt,
        authorId: "11111111-1111-4111-8111-111111111111",
      }),
      true,
    );
  });

  it("falls back to timestamp-after-enable when author id is null", () => {
    const enabledAt = "2026-11-23T12:00:00.000Z";
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: "2026-11-23T12:00:01.000Z",
        demoEnabledAt: enabledAt,
        authorId: null,
      }),
      false,
    );
    assert.equal(
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: "2026-11-23T12:05:00.000Z",
        demoEnabledAt: enabledAt,
        authorId: null,
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

describe("demo song idea list cascade safety", () => {
  it("keeps demo lists that still hold client ideas and deletes empty ones", () => {
    assert.equal(demoSongIdeaListFate({ listIsDemo: true, remainingIdeaCount: 2 }), "keep_as_real");
    assert.equal(demoSongIdeaListFate({ listIsDemo: true, remainingIdeaCount: 0 }), "delete");
    assert.equal(demoSongIdeaListFate({ listIsDemo: false, remainingIdeaCount: 0 }), "skip");
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

  it("reseedEventPlanning exits Demo Mode and clears leftover demo song ideas / do-not-play", () => {
    const planning = read("src/lib/planning.ts");
    assert.match(planning, /demo_mode:\s*false/);
    assert.match(planning, /demo_mode_enabled_at:\s*null/);
    assert.match(planning, /clearDemoSongIdeaLists/);
    assert.match(planning, /clearDemoDoNotPlayNotes/);
    assert.match(planning, /seedPlanningSkeletonFromTemplate/);
    assert.match(planning, /is_demo:\s*isDemo/);
  });

  it("seeds from the event planning template with a robust Wedding 2026 fallback", () => {
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /resolveDemoPlanningTemplateId/);
    assert.match(lib, /seedPlanningSkeletonFromTemplate/);
    assert.match(lib, /PREFERRED_DEMO_TEMPLATE_ID|PREFERRED_DEMO_TEMPLATE_NAME/);
    assert.match(lib, /demoAnswerForQuestion/);
    assert.match(lib, /assignDemoSongsToSections/);
    assert.doesNotMatch(lib, /DEMO_SECTIONS|DEMO_QUESTIONS/);
    assert.equal(PREFERRED_DEMO_TEMPLATE_ID, "a1c50a27-3fd5-4f4f-95b2-b7ee2d1e7dd7");
    assert.equal(PREFERRED_DEMO_TEMPLATE_NAME, "Xpress Entertainment Wedding 2026");
    const answers = read("src/lib/demoModeAnswers.ts");
    assert.match(answers, /PREFERRED_DEMO_TEMPLATE_ID/);
    assert.match(answers, /PREFERRED_DEMO_TEMPLATE_NAME/);
  });

  it("keep_client path uses cascade-safe song idea list cleanup and author ids", () => {
    const lib = read("src/lib/demoMode.ts");
    assert.match(lib, /clearDemoSongIdeaLists/);
    assert.doesNotMatch(lib, /from\("song_idea_lists"\)\.delete\(\)\.eq\("event_id", eventId\)\.eq\("is_demo", true\)/);
    assert.match(lib, /answered_by/);
    assert.match(lib, /updated_by/);
    assert.match(lib, /authorId:\s*a\.answered_by/);
    assert.match(lib, /authorId:\s*dnp\.updated_by/);
    const cleanup = read("src/lib/demoModeCleanup.ts");
    assert.match(cleanup, /demoSongIdeaListFate/);
    assert.match(cleanup, /keep_as_real/);
  });

  it("exposes demo_mode on events_get and a safe set tool with no outbound comms", () => {
    const office = read("src/lib/mcp/tools/office.ts");
    assert.match(office, /demo_mode/);
    assert.match(office, /events_set_demo_mode/);
    assert.match(office, /enableEventDemoMode/);
    assert.match(office, /disableEventDemoMode/);
    assert.match(office, /planning template/i);
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
    assert.match(actions, /revalidatePath\(`\/portal\/plan\/\$\{eventId\}`\)/);
    assert.doesNotMatch(actions, /processOutbox|sendAccountInvite|emailAppJoinCode/);
    const ui = read("src/components/EventDemoMode.tsx");
    assert.doesNotMatch(ui, /\u2014/);
    assert.match(ui, /planning template/i);
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
