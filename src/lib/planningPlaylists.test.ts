import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  WEDDING_2026_PLAYLIST_TITLES,
  WEDDING_2026_TEMPLATE_ID,
  buildPlaylists,
  titleLooksLikePlaylistMoment,
} from "./planningPlaylists.ts";
import { assignDemoSongsToSections } from "./demoModeAnswers.ts";
import { DEMO_SONGS } from "./demoModeSeed.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("playlist moments schema + cloning", () => {
  it("adds is_playlist on template and event sections in 00241 (after PR 95's 00240)", () => {
    assert.equal(existsSync(join(root, "supabase/migrations/00241_planning_playlist_moments.sql")), true);
    const mig = readFileSync(join(root, "supabase/migrations/00241_planning_playlist_moments.sql"), "utf8");
    assert.match(mig, /planning_template_sections[\s\S]*is_playlist boolean not null default false/);
    assert.match(mig, /planning_sections[\s\S]*is_playlist boolean not null default false/);
    assert.match(mig, /00240/);
    assert.match(mig, new RegExp(WEDDING_2026_TEMPLATE_ID));
    for (const title of WEDDING_2026_PLAYLIST_TITLES) {
      assert.match(mig, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Backfill title list is only the four playlist moments (comments may mention exclusions).
    const titleList = mig.slice(mig.indexOf("title in ("), mig.indexOf(");", mig.indexOf("title in (")));
    assert.doesNotMatch(titleList, /Must Play/);
    assert.doesNotMatch(titleList, /Don.t Play/);
    assert.doesNotMatch(titleList, /First Dance/);
    assert.doesNotMatch(titleList, /Slow Dance/);
  });

  it("copies is_playlist when seeding from a template", () => {
    const lib = readFileSync(join(root, "src/lib/planning.ts"), "utf8");
    assert.match(lib, /is_playlist: Boolean\(ts\.is_playlist\)/);
    assert.match(lib, /is_playlist: Boolean\(sec\.is_playlist\)/);
  });

  it("exposes is_playlist on MCP event section patches", () => {
    const edits = readFileSync(join(root, "src/lib/officeEdits.ts"), "utf8");
    assert.match(edits, /"is_playlist"/);
    const mcp = readFileSync(join(root, "docs/mcp.md"), "utf8");
    assert.match(mcp, /is_playlist/);
  });
});

describe("buildPlaylists", () => {
  const sections = [
    { id: "p1", title: "Cocktail Vibes", isPlaylist: true, songLimit: 20, guestEnabled: true, sortOrder: 1 },
    { id: "p2", title: "Dinner Music", isPlaylist: true, songLimit: 20, guestEnabled: false, sortOrder: 2 },
    { id: "fd", title: "First Dance", isPlaylist: false, songLimit: 1, guestEnabled: true, sortOrder: 3 },
    { id: "gone", title: "Old Cocktail", isPlaylist: true, guestEnabled: true, deletedByHost: true, sortOrder: 0 },
  ];
  const songs = [
    { id: "s1", sectionId: "p1", title: "Levitating", artist: "Dua Lipa", sortOrder: 1 },
    { id: "s2", sectionId: "p1", title: "Blinding Lights", artist: "The Weeknd", sortOrder: 0 },
    { id: "s3", sectionId: "p2", title: "Fly Me to the Moon", artist: "Sinatra", sortOrder: 0 },
    { id: "s4", sectionId: "fd", title: "At Last", artist: "Etta", sortOrder: 0 },
  ];

  it("groups ordered songs under playlist moments only", () => {
    const playlists = buildPlaylists({ sections, songs, role: "host" });
    assert.equal(playlists.length, 2);
    assert.equal(playlists[0].sectionId, "p1");
    assert.deepEqual(
      playlists[0].songs.map((s) => s.title),
      ["Blinding Lights", "Levitating"],
    );
    assert.equal(playlists[1].title, "Dinner Music");
    assert.equal(playlists[1].songs.length, 1);
  });

  it("hides non-guest playlists from guests", () => {
    const playlists = buildPlaylists({ sections, songs, role: "guest" });
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].sectionId, "p1");
  });

  it("recognizes clear playlist-moment titles", () => {
    assert.equal(titleLooksLikePlaylistMoment("Ceremony Prelude (Guest Arrival)"), true);
    assert.equal(titleLooksLikePlaylistMoment("Cocktail Vibes"), true);
    assert.equal(titleLooksLikePlaylistMoment("Dinner Music"), true);
    assert.equal(titleLooksLikePlaylistMoment("Dance Floor Suggestions"), true);
    assert.equal(titleLooksLikePlaylistMoment("First Dance"), false);
    assert.equal(titleLooksLikePlaylistMoment("Don't Play"), false);
    assert.equal(titleLooksLikePlaylistMoment("Must Play Songs"), false);
  });
});

describe("demo songs prefer playlist moments", () => {
  it("still fills playlist sections by title and prefers is_playlist order", () => {
    const sections = [
      { id: "fd", title: "First Dance", songs_enabled: true, song_limit: 1, is_playlist: false },
      { id: "ck", title: "Cocktail Vibes", songs_enabled: true, song_limit: 5, is_playlist: true },
      { id: "dn", title: "Dinner Music", songs_enabled: true, song_limit: 5, is_playlist: true },
    ];
    const placed = assignDemoSongsToSections(sections, DEMO_SONGS);
    const bySection = new Map<string, number>();
    for (const row of placed) bySection.set(row.section_id, (bySection.get(row.section_id) ?? 0) + 1);
    assert.ok((bySection.get("ck") ?? 0) > 0);
    assert.ok((bySection.get("dn") ?? 0) > 0);
    assert.ok((bySection.get("fd") ?? 0) > 0);
  });
});

describe("mobile playlist API contract", () => {
  it("ships playlists GET + song mutation route", () => {
    assert.equal(existsSync(join(root, "src/app/api/mobile/events/[eventId]/playlists/route.ts")), true);
    assert.equal(existsSync(join(root, "src/app/api/mobile/planning/songs/route.ts")), true);
    const songsRoute = readFileSync(join(root, "src/app/api/mobile/planning/songs/route.ts"), "utf8");
    assert.match(songsRoute, /action === "add"/);
    assert.match(songsRoute, /action === "remove"/);
    assert.match(songsRoute, /action === "reorder"/);
    const content = readFileSync(join(root, "src/app/api/mobile/events/[eventId]/content/route.ts"), "utf8");
    assert.match(content, /playlists/);
  });

  it("staff UI toggles playlist moments on templates and events", () => {
    const template = readFileSync(join(root, "src/components/planner/TemplateBuilder.tsx"), "utf8");
    assert.match(template, /Playlist moment/);
    assert.match(template, /is_playlist/);
    const settings = readFileSync(join(root, "src/components/planner/SectionSettings.tsx"), "utf8");
    assert.match(settings, /isPlaylist/);
    assert.match(settings, /Playlist moment/);
    const notes = readFileSync(join(root, "src/components/planner/SectionMomentNotes.tsx"), "utf8");
    assert.match(notes, /EventPlaylistsPanel/);
  });
});
