/* Event Demo Mode — seed / clear sample planner data for prospects.
   Server-only. Uses the service-role admin client so hard-deletes pass
   ugc_block_hard_delete (same path as reseedEventPlanning). Never touches
   hide_financials or comms_paused, and never queues email/SMS. */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureEventPlanning } from "@/lib/planning";
import {
  decideEnableDemoMode,
  isClientEditedDemoAnswer,
  preservedEventFlags,
  type DemoDisableMode,
  type RealPlanningSnapshot,
} from "@/lib/demoModeLogic";
import { clearDemoSongIdeaLists } from "@/lib/demoModeCleanup";
import {
  DEMO_DO_NOT_PLAY_NOTES,
  DEMO_QUESTIONS,
  DEMO_SECTIONS,
  DEMO_SONG_IDEAS,
  DEMO_SONGS,
} from "@/lib/demoModeSeed";

export type { DemoDisableMode, RealPlanningSnapshot };
export { hasRealPlanningData, isClientEditedDemoAnswer, decideEnableDemoMode } from "@/lib/demoModeLogic";
export { clearDemoSongIdeaLists } from "@/lib/demoModeCleanup";

export type DemoModeResult =
  | { ok: true; already?: boolean; seeded?: boolean; mode?: DemoDisableMode }
  | { ok: false; error: string; code?: "HAS_REAL_DATA" | "NOT_DEMO" | "NOT_FOUND" };

type Admin = ReturnType<typeof createAdminClient>;

async function loadRealPlanningSnapshot(admin: Admin, eventId: string): Promise<RealPlanningSnapshot> {
  const [answers, songs, ideas, notes, dnp] = await Promise.all([
    admin
      .from("planning_question_answers")
      .select("question_id, is_demo, answer")
      .eq("event_id", eventId),
    admin.from("planning_songs").select("id, is_demo").eq("event_id", eventId),
    admin.from("song_ideas").select("id, is_demo").eq("event_id", eventId),
    admin
      .from("planning_sections")
      .select("id, client_notes, is_demo")
      .eq("event_id", eventId)
      .not("client_notes", "is", null),
    admin.from("planning_do_not_play_notes").select("body, is_demo").eq("event_id", eventId).maybeSingle(),
  ]);

  const nonDemoAnswers = (answers.data ?? []).filter(
    (a) => !a.is_demo && a.answer != null && String(a.answer).trim() !== "",
  ).length;
  const nonDemoSongs = (songs.data ?? []).filter((s) => !s.is_demo).length;
  const nonDemoSongIdeas = (ideas.data ?? []).filter((s) => !s.is_demo).length;
  const clientNotes = (notes.data ?? []).filter(
    (s) => !s.is_demo && s.client_notes != null && String(s.client_notes).trim() !== "",
  ).length;
  const doNotPlayNotes = Boolean(
    dnp.data && !dnp.data.is_demo && dnp.data.body != null && String(dnp.data.body).trim() !== "",
  );

  return { nonDemoAnswers, nonDemoSongs, nonDemoSongIdeas, clientNotes, doNotPlayNotes };
}

/** Wipe every planner row for an event (sections cascade to questions/answers/songs).
    Staff/service-role only — required for ugc_block_hard_delete. Also clears
    soft-hidden demo songs via hard delete. */
async function wipeEventPlanning(admin: Admin, eventId: string): Promise<void> {
  await admin.from("planning_sections").delete().eq("event_id", eventId);
  await admin.from("song_ideas").delete().eq("event_id", eventId);
  await admin.from("song_idea_lists").delete().eq("event_id", eventId);
  await admin.from("planning_do_not_play_notes").delete().eq("event_id", eventId);
  await admin.from("planning_section_staff_notes").delete().eq("event_id", eventId);
}

async function seedDemoPlanning(admin: Admin, eventId: string): Promise<void> {
  const sectionIds = new Map<string, string>();
  const questionIds = new Map<string, string>();

  const sectionRows = DEMO_SECTIONS.map((s) => {
    const id = crypto.randomUUID();
    sectionIds.set(s.key, id);
    return {
      id,
      event_id: eventId,
      template_section_id: null,
      title: s.title,
      icon: s.icon,
      section_type: s.section_type,
      intro: s.intro,
      time_label: s.time_label,
      client_editable: s.client_editable,
      song_limit: s.song_limit,
      locked: false,
      sort_order: s.sort_order,
      guest_enabled: s.guest_enabled,
      songs_enabled: s.songs_enabled,
      questions_enabled: s.questions_enabled,
      notes_enabled: s.notes_enabled,
      time_enabled: s.time_enabled,
      must_play_limit: null,
      permissions: {},
      module: null,
      ai_picks_enabled: false,
      on_timeline: s.on_timeline,
      on_music: s.on_music,
      is_demo: true,
    };
  });
  const { error: secErr } = await admin.from("planning_sections").insert(sectionRows);
  if (secErr) throw new Error(secErr.message);

  const questionRows = DEMO_QUESTIONS.map((q) => {
    const id = crypto.randomUUID();
    questionIds.set(q.key, id);
    const sectionId = sectionIds.get(q.sectionKey);
    if (!sectionId) throw new Error(`Demo seed missing section ${q.sectionKey}`);
    return {
      id,
      section_id: sectionId,
      event_id: eventId,
      prompt: q.prompt,
      help_text: q.help_text,
      answer_type: q.answer_type,
      options: q.options,
      required: q.required,
      sort_order: q.sort_order,
      condition_question_id: null,
      condition_values: [],
      is_demo: true,
    };
  });
  const { error: qErr } = await admin.from("planning_questions").insert(questionRows);
  if (qErr) throw new Error(qErr.message);

  const answerRows = DEMO_QUESTIONS.filter((q) => q.answer != null && String(q.answer).trim() !== "").map(
    (q) => ({
      question_id: questionIds.get(q.key)!,
      event_id: eventId,
      answer: q.answer,
      answered_by: null,
      is_demo: true,
    }),
  );
  if (answerRows.length) {
    const { error: aErr } = await admin.from("planning_question_answers").insert(answerRows);
    if (aErr) throw new Error(aErr.message);
  }

  const songRows = DEMO_SONGS.map((s) => {
    const sectionId = sectionIds.get(s.sectionKey);
    if (!sectionId) throw new Error(`Demo seed missing section ${s.sectionKey}`);
    return {
      id: crypto.randomUUID(),
      section_id: sectionId,
      event_id: eventId,
      provider: s.provider,
      provider_id: s.provider_id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      artwork_url: s.artwork_url,
      duration_ms: s.duration_ms,
      preview_url: s.preview_url,
      external_url: s.external_url,
      note: s.note,
      requested_by: null,
      sort_order: s.sort_order,
      must_play: s.must_play,
      do_not_play: s.do_not_play,
      synced: false,
      is_demo: true,
    };
  });
  const { error: songErr } = await admin.from("planning_songs").insert(songRows);
  if (songErr) throw new Error(songErr.message);

  const listId = crypto.randomUUID();
  const { error: listErr } = await admin.from("song_idea_lists").insert({
    id: listId,
    event_id: eventId,
    name: "Song Ideas",
    sort_order: 0,
    is_demo: true,
  });
  if (listErr) throw new Error(listErr.message);

  const ideaRows = DEMO_SONG_IDEAS.map((s) => ({
    id: crypto.randomUUID(),
    list_id: listId,
    event_id: eventId,
    provider: s.provider,
    provider_id: s.provider_id,
    title: s.title,
    artist: s.artist,
    album: s.album,
    artwork_url: s.artwork_url,
    duration_ms: s.duration_ms,
    preview_url: s.preview_url,
    external_url: s.external_url,
    note: null,
    added_by: null,
    sort_order: s.sort_order,
    is_demo: true,
  }));
  const { error: ideaErr } = await admin.from("song_ideas").insert(ideaRows);
  if (ideaErr) throw new Error(ideaErr.message);

  const { error: dnpErr } = await admin.from("planning_do_not_play_notes").upsert(
    {
      event_id: eventId,
      body: DEMO_DO_NOT_PLAY_NOTES,
      is_demo: true,
    },
    { onConflict: "event_id" },
  );
  if (dnpErr) throw new Error(dnpErr.message);
}

/**
 * Turn Demo Mode ON for an event. Idempotent when already on.
 * Refuses when real (non-demo) planning data exists unless force=true.
 * Does not change hide_financials / comms_paused and sends no messages.
 */
export async function enableEventDemoMode(
  eventId: string,
  opts: { force?: boolean } = {},
): Promise<DemoModeResult> {
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("events")
    .select("id, demo_mode, hide_financials, comms_paused, event_type_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!event) return { ok: false, error: "Event not found.", code: "NOT_FOUND" };

  const { count } = await admin
    .from("planning_sections")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("is_demo", true);

  const snap = await loadRealPlanningSnapshot(admin, eventId);
  const decision = decideEnableDemoMode({
    demoMode: Boolean(event.demo_mode),
    existingDemoSections: count ?? 0,
    real: snap,
    force: opts.force,
  });

  if (decision === "already") return { ok: true, already: true };
  if (decision === "refuse_real_data") {
    return {
      ok: false,
      code: "HAS_REAL_DATA",
      error:
        "This event already has real planning answers, songs, or notes. Confirm to replace them with Demo Mode sample data.",
    };
  }

  const preserved = preservedEventFlags(event);

  await wipeEventPlanning(admin, eventId);
  await seedDemoPlanning(admin, eventId);

  const { error: upErr } = await admin
    .from("events")
    .update({
      demo_mode: true,
      demo_mode_enabled_at: new Date().toISOString(),
      planning_seeded: true,
      hide_financials: preserved.hide_financials,
      comms_paused: preserved.comms_paused,
    })
    .eq("id", eventId);
  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, already: decision === "repair", seeded: true };
}

async function removeDemoLeavesOnly(admin: Admin, eventId: string, demoEnabledAt: string | null): Promise<void> {
  // Include soft-hidden demo songs (hard delete as service role).
  await admin.from("planning_songs").delete().eq("event_id", eventId).eq("is_demo", true);
  await clearDemoSongIdeaLists(admin, eventId);

  const { data: dnp } = await admin
    .from("planning_do_not_play_notes")
    .select("body, is_demo, updated_at, updated_by")
    .eq("event_id", eventId)
    .maybeSingle();
  if (dnp?.is_demo) {
    const edited = isClientEditedDemoAnswer({
      isDemo: true,
      updatedAt: dnp.updated_at,
      demoEnabledAt,
      authorId: dnp.updated_by,
    });
    if (edited) {
      await admin.from("planning_do_not_play_notes").update({ is_demo: false }).eq("event_id", eventId);
    } else {
      await admin.from("planning_do_not_play_notes").delete().eq("event_id", eventId);
    }
  }

  const { data: answers } = await admin
    .from("planning_question_answers")
    .select("question_id, is_demo, updated_at, answered_by, answer")
    .eq("event_id", eventId)
    .eq("is_demo", true);

  for (const a of answers ?? []) {
    if (
      isClientEditedDemoAnswer({
        isDemo: true,
        updatedAt: a.updated_at,
        demoEnabledAt,
        authorId: a.answered_by,
      })
    ) {
      await admin
        .from("planning_question_answers")
        .update({ is_demo: false })
        .eq("question_id", a.question_id)
        .eq("event_id", eventId);
    } else {
      await admin
        .from("planning_question_answers")
        .delete()
        .eq("question_id", a.question_id)
        .eq("event_id", eventId);
    }
  }

  // Keep skeleton so the iOS app still has chapters/questions to render.
  await admin.from("planning_questions").update({ is_demo: false }).eq("event_id", eventId).eq("is_demo", true);
  await admin.from("planning_sections").update({ is_demo: false }).eq("event_id", eventId).eq("is_demo", true);
}

/**
 * Turn Demo Mode OFF.
 * - clean_slate (default): wipe all planner rows (demo + any test edits), then
 *   re-seed a blank template via ensureEventPlanning.
 * - keep_client: remove only seeded demo leaves; preserve client-added songs /
 *   edited answers / notes; keep section/question skeleton.
 */
export async function disableEventDemoMode(
  eventId: string,
  mode: DemoDisableMode = "clean_slate",
): Promise<DemoModeResult> {
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("events")
    .select("id, demo_mode, demo_mode_enabled_at, hide_financials, comms_paused, event_type_id, planning_template_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!event) return { ok: false, error: "Event not found.", code: "NOT_FOUND" };
  if (!event.demo_mode) return { ok: false, error: "Demo Mode is not on for this event.", code: "NOT_DEMO" };

  const preserved = preservedEventFlags(event);

  if (mode === "clean_slate") {
    await wipeEventPlanning(admin, eventId);
    const { error: upErr } = await admin
      .from("events")
      .update({
        demo_mode: false,
        demo_mode_enabled_at: null,
        planning_seeded: false,
        hide_financials: preserved.hide_financials,
        comms_paused: preserved.comms_paused,
      })
      .eq("id", eventId);
    if (upErr) return { ok: false, error: upErr.message };
    await ensureEventPlanning(eventId, event.event_type_id ?? null);
  } else {
    await removeDemoLeavesOnly(admin, eventId, event.demo_mode_enabled_at ?? null);
    const { error: upErr } = await admin
      .from("events")
      .update({
        demo_mode: false,
        demo_mode_enabled_at: null,
        planning_seeded: true,
        hide_financials: preserved.hide_financials,
        comms_paused: preserved.comms_paused,
      })
      .eq("id", eventId);
    if (upErr) return { ok: false, error: upErr.message };
  }

  return { ok: true, mode };
}
