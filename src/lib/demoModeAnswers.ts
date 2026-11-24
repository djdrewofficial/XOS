/* Pure helpers: sample answers + song placement for Event Demo Mode.
   Safe for unit tests (no DB / no server-only). */

import type { DemoAnswerType, DemoSongSeed } from "./demoModeSeed.ts";

export type DemoQuestionForAnswer = {
  prompt: string;
  help_text?: string | null;
  answer_type: DemoAnswerType | string;
  options?: unknown;
};

export type DemoSectionForSongs = {
  id: string;
  title: string;
  songs_enabled: boolean;
  song_limit: number | null;
};

/** Preferred catalog template when an event has no planning_template_id.
    Look up by id first, then by exact name — id alone must not hard-fail
    other environments. */
export const PREFERRED_DEMO_TEMPLATE_ID = "a1c50a27-3fd5-4f4f-95b2-b7ee2d1e7dd7";
export const PREFERRED_DEMO_TEMPLATE_NAME = "Xpress Entertainment Wedding 2026";

function optionLabels(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => {
      if (typeof o === "string") return o;
      if (o && typeof o === "object" && "label" in o && typeof (o as { label: unknown }).label === "string") {
        return (o as { label: string }).label;
      }
      return null;
    })
    .filter((s): s is string => Boolean(s && s.trim()));
}

function pickOption(labels: string[], prefer?: RegExp[]): string | null {
  if (!labels.length) return null;
  for (const re of prefer ?? []) {
    const hit = labels.find((l) => re.test(l));
    if (hit) return hit;
  }
  // Skip "N/A" / "Not…" when something else exists.
  const nonNa = labels.find((l) => !/^n\/?a\b/i.test(l) && !/^not\b/i.test(l));
  return nonNa ?? labels[0];
}

function pickMulti(labels: string[], count: number, prefer?: RegExp[]): string | null {
  if (!labels.length) return null;
  const chosen: string[] = [];
  for (const re of prefer ?? []) {
    const hit = labels.find((l) => re.test(l) && !chosen.includes(l));
    if (hit) chosen.push(hit);
    if (chosen.length >= count) break;
  }
  for (const l of labels) {
    if (chosen.length >= count) break;
    if (!chosen.includes(l) && !/^n\/?a\b/i.test(l)) chosen.push(l);
  }
  return chosen.length ? chosen.join("|") : null;
}

/** Realistic wedding-demo answers keyed off prompt + answer_type. */
export function demoAnswerForQuestion(q: DemoQuestionForAnswer): string | null {
  const prompt = (q.prompt ?? "").trim();
  const p = prompt.toLowerCase();
  const type = String(q.answer_type || "short");
  const labels = optionLabels(q.options);

  if (type === "yesno") {
    if (/not doing|skip|without/.test(p)) return "no";
    // Default wedding demo says yes to standard moments.
    if (/garter|bouquet toss|grand exit|cocktail hour|father|mother|blessing|speakers?/.test(p)) return "yes";
    if (/children|kids/.test(p)) return "yes";
    return "yes";
  }

  if (type === "scale") return "8";

  if (type === "select" || type === "image_select") {
    if (/dinner be served|how will dinner/.test(p)) {
      return pickOption(labels, [/^plated$/i]) ?? "Plated";
    }
    if (/clean/.test(p)) {
      return pickOption(labels, [/prefer clean|clean versions only/i]) ?? pickOption(labels);
    }
    if (/guest requests?/.test(p)) {
      return pickOption(labels, [/when they fit/i]) ?? pickOption(labels);
    }
    if (/who will provide music for dinner/.test(p)) {
      return pickOption(labels, [/the dj/i]) ?? pickOption(labels);
    }
    if (/buffet.*released|tables released/.test(p)) {
      return pickOption(labels, [/n\/a/i, /dj releases/i]) ?? pickOption(labels);
    }
    if (/wedding party introduced|introduced\?/.test(p) && /couple|party|group|individual/i.test(labels.join(" "))) {
      return pickOption(labels, [/as couples/i]) ?? pickOption(labels);
    }
    if (/name style/.test(p)) {
      return pickOption(labels, [/first and last/i]) ?? pickOption(labels);
    }
    if (/grandparents? be introduced|parents? be introduced/.test(p)) {
      return pickOption(labels, [/walking in/i]) ?? pickOption(labels);
    }
    if (/cake cutting|announce.*cake|keep it private/.test(p)) {
      return pickOption(labels, [/announce/i]) ?? pickOption(labels);
    }
    if (/dessert be served/.test(p)) {
      return pickOption(labels, [/dessert table/i, /serve at tables/i]) ?? pickOption(labels);
    }
    if (/entire song|fade out|custom edit/.test(p)) {
      return pickOption(labels, [/fade out/i]) ?? pickOption(labels);
    }
    if (/send.?off|grand exit/.test(p) && labels.some((l) => /sparkler|bubble/i.test(l))) {
      return pickOption(labels, [/sparkler/i]) ?? pickOption(labels);
    }
    return pickOption(labels);
  }

  if (type === "multiselect") {
    if (/prelude|guest arrival|styles below/.test(p)) {
      return pickMulti(labels, 2, [/classic instrumental/i, /modern instrumental/i]);
    }
    if (/cocktail hour vibes|cocktail vibes/.test(p)) {
      return pickMulti(labels, 2, [/classy/i, /soulful/i, /jazz/i]);
    }
    if (/dinner music vibes/.test(p)) {
      return pickMulti(labels, 2, [/elegant/i, /romantic/i, /jazz/i]);
    }
    if (/dance floor|genres and styles/.test(p)) {
      return pickMulti(labels, 4, [/top 40/i, /2010s/i, /motown/i, /latin pop/i, /wedding classics/i]);
    }
    if (/group dances|line dance/.test(p)) {
      return pickMulti(labels, 2, [/cha cha/i, /wobble/i]);
    }
    if (/seating|while guests/.test(p)) {
      return pickMulti(labels, 2, [/jazz/i, /acoustic/i, /classical/i]);
    }
    return pickMulti(labels, Math.min(2, labels.length));
  }

  // short / long / unknown — keyword heuristics
  if (/how many guests|guest count|guests are you expecting|guests will be attending/.test(p)) return "120";
  if (/age range/.test(p)) return "Mostly 25 to 60";
  if (/color palette|wedding colors|theme\?/.test(p)) return "Sage green and gold, garden theme";
  if (/vibe.*one sentence|describe it in one sentence/.test(p)) {
    return "Elegant garden party that turns into a packed dance floor.";
  }
  if (/social media|hashtag/.test(p)) return "@alexandjordan · #AlexAndJordan2026";
  if (/traditions/.test(p)) return "A short bilingual welcome from both families after introductions.";
  if (/party level|like to party/.test(p)) return "8";
  if (/interactive.*dj|dj\/mc/.test(p)) return "Friendly and upbeat, keep announcements short.";
  if (/do not want played|do NOT want|artists or genres you do not/.test(p)) {
    return "No heavy metal. No explicit lyrics during dinner.";
  }
  if (/getting ready/.test(p) && /time/.test(p)) return "2:30 pm";
  if (/access the venue|load-?in|setup\?/.test(p)) return "3:00 pm";
  if (/ceremony venue|specific location/.test(p)) return "Garden terrace at the venue";
  if (/after the ceremony|right after/.test(p)) return "Cocktail hour on the patio, then ballroom for dinner";
  if (/cocktail hour\?/.test(p) && type === "short") return "Yes — patio cocktail hour";
  if (/same room as the main reception|where will it take place/.test(p)) {
    return "Cocktail hour is on the patio; reception is in the main ballroom.";
  }
  if (/who else is speaking|speakers/.test(p)) return "Maid of honor reads a short poem mid-ceremony.";
  if (/list the names of everyone entering|order they will walk|wedding party members in entrance/.test(p)) {
    return "Parents of the couple, bridal party in pairs (Alex's side first), then the couple.";
  }
  if (/walking you down the aisle|who\?/.test(p) && /aisle|bride|processional/.test(p)) {
    return "Alex walks with both parents";
  }
  if (/specific part of the song/.test(p)) return "Start at the chorus / 0:45";
  if (/grandparents.? names|pronounce/.test(p)) {
    return "Marta & Luis Rivera (MAR-tah, loo-EES); Helen & Robert Chen";
  }
  if (/bride.?s parents|groom.?s parents|want them introduced/.test(p)) {
    return "Parents of the bride: Maria & David Cruz. Parents of the groom: Susan & James Patel.";
  }
  if (/how should we introduce you/.test(p)) return "Mr. and Mrs. Alex & Jordan Patel!";
  if (/entrance song|instructions for your entrance/.test(p)) return "Hit the drop when the doors open.";
  if (/toast.*order|everyone giving a toast/.test(p)) {
    return "Best man (Chris), maid of honor (Sam), then parents of the couple.";
  }
  if (/who is giving the blessing/.test(p)) return "Uncle Marco";
  if (/who are you dancing with/.test(p)) {
    if (/father|daughter/.test(p)) return "Dad — David Cruz";
    if (/mother|son/.test(p)) return "Mom — Susan Patel";
    return "Dad — David Cruz";
  }
  if (/bouquet toss/.test(p) && /instruction/.test(p)) return "Call single friends to the dance floor first.";
  if (/garter/.test(p) && /instruction/.test(p)) return "Keep it PG — quick and fun.";
  if (/last dance|special meaning/.test(p)) return "This was playing the night we got engaged.";
  if (/grand exit/.test(p) && /planned|what do you have/.test(p)) return "Sparklers on the front steps";
  if (/where will the grand exit/.test(p)) return "Front steps of the venue";
  if (/load-in|special instructions or challenges/.test(p)) return "Use the service elevator on the east side.";
  if (/music preferences for guest arrival|other music preferences/.test(p)) {
    return "Soft and elegant — nothing with heavy vocals.";
  }

  // Generic fallbacks so most template questions still look filled.
  if (type === "long") {
    return "Happy to follow your lead — keep this moment warm and personal.";
  }
  if (type === "short") {
    if (/\btime\b|what time|o'?clock|am\b|pm\b/.test(p)) return "5:00 pm";
    if (/\bwho\b/.test(p)) return "Alex & Jordan";
    if (/\bwhere\b|location|venue/.test(p)) return "Main ballroom";
    return "See notes — demo sample";
  }
  return null;
}

/** Map a live section title to the demo song catalog role (legacy sectionKey). */
export function demoSongRoleForSectionTitle(title: string): string | null {
  const t = title.toLowerCase().trim();
  if (!t) return null;
  if (/don'?t play|do not play|avoid list/.test(t)) return "dont-play";
  if (/must play/.test(t)) return "must-play";
  if (/slow dance/.test(t)) return "tl-slow";
  if (/first dance/.test(t)) return "tl-first-dance";
  if (/father.?daughter/.test(t)) return "tl-father-daughter";
  if (/mother.?son/.test(t)) return "tl-mother-son";
  if (/parent dance/.test(t)) return "tl-parent-dances";
  if (/cake/.test(t)) return "tl-cake";
  if (/bouquet/.test(t)) return "tl-bouquet";
  if (/garter/.test(t)) return "tl-garter";
  if (/grand exit|send.?off/.test(t)) return "tl-grand-exit";
  if (/last dance|last song/.test(t)) return "tl-last-song";
  if (/dance floor|open dancing|party playlist/.test(t)) return "tl-open";
  if (/couple entrance|bridal party entrance|reception entrance/.test(t)) return "tl-entrance";
  if (/introduction/.test(t)) return "tl-entrance";
  if (/dinner/.test(t)) return "tl-dinner";
  if (/cocktail/.test(t)) return "tl-cocktail";
  if (/recessional|couple'?s exit/.test(t)) return "tl-recessional";
  if (/bride|bridal|aisle/.test(t) && /processional|entrance|walk/.test(t)) return "tl-bridal";
  if (/processional.*bride|bride.*processional/.test(t)) return "tl-bridal";
  if (/processional/.test(t)) return "tl-processional";
  if (/prelude|guest arrival|seating music|ceremony seating/.test(t)) return "tl-seating";
  if (/getting ready/.test(t)) return "tl-getting-ready";
  return null;
}

/** Alias parent-dance catalog keys onto the specific father/mother roles. */
function songMatchesRole(song: DemoSongSeed, role: string): boolean {
  if (role === "dont-play") return song.do_not_play;
  if (role === "must-play") return song.must_play && !song.do_not_play;
  if (role === "tl-father-daughter") {
    return song.sectionKey === "tl-parent-dances" && song.sort_order === 0;
  }
  if (role === "tl-mother-son") {
    return song.sectionKey === "tl-parent-dances" && song.sort_order === 1;
  }
  if (role === "tl-bouquet" || role === "tl-garter") {
    return song.sectionKey === "tl-open" && !song.do_not_play;
  }
  return song.sectionKey === role;
}

/**
 * Place demo songs onto template sections by title. Respects song_limit.
 * Returns rows ready for insert (caller adds event_id / is_demo / fresh ids).
 */
export function assignDemoSongsToSections(
  sections: DemoSectionForSongs[],
  catalog: DemoSongSeed[],
): { section_id: string; song: DemoSongSeed; sort_order: number }[] {
  const musicSections = sections.filter((s) => s.songs_enabled);
  const usedKeys = new Set<string>();
  const out: { section_id: string; song: DemoSongSeed; sort_order: number }[] = [];

  function take(role: string, limit: number): DemoSongSeed[] {
    const matches = catalog.filter((s) => songMatchesRole(s, role) && !usedKeys.has(s.key));
    const picked = matches.slice(0, Math.max(0, limit));
    for (const s of picked) usedKeys.add(s.key);
    return picked;
  }

  for (const section of musicSections) {
    const role = demoSongRoleForSectionTitle(section.title);
    const cap =
      section.song_limit != null && section.song_limit > 0
        ? section.song_limit
        : role === "tl-open" || role === "must-play"
          ? 5
          : role === "dont-play"
            ? 2
            : 3;
    let picked = role ? take(role, cap) : [];
    // Fallback: leftover non-DNP party songs so music sections aren't empty.
    if (!picked.length) {
      picked = take("tl-open", Math.min(cap, 2));
    }
    if (!picked.length && role !== "dont-play") {
      const any = catalog.filter((s) => !s.do_not_play && !usedKeys.has(s.key)).slice(0, Math.min(cap, 1));
      for (const s of any) usedKeys.add(s.key);
      picked = any;
    }
    picked.forEach((song, idx) => {
      out.push({ section_id: section.id, song, sort_order: idx });
    });
  }
  return out;
}
