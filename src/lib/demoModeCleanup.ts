/* Shared Demo Mode cleanup helpers used by demoMode.ts and reseedEventPlanning.
   No import of planning.ts / demoMode.ts — keeps the graph acyclic. */
import type { createAdminClient } from "@/lib/supabase/admin";
import { demoSongIdeaListFate } from "@/lib/demoModeLogic";

type Admin = ReturnType<typeof createAdminClient>;

/** Delete demo song_ideas, then only delete empty demo lists. Lists that still
    hold client-added ideas are unmarked so ON DELETE CASCADE never wipes them. */
export async function clearDemoSongIdeaLists(admin: Admin, eventId: string): Promise<void> {
  await admin.from("song_ideas").delete().eq("event_id", eventId).eq("is_demo", true);

  const { data: lists } = await admin
    .from("song_idea_lists")
    .select("id, is_demo")
    .eq("event_id", eventId)
    .eq("is_demo", true);

  for (const list of lists ?? []) {
    const { count } = await admin
      .from("song_ideas")
      .select("id", { count: "exact", head: true })
      .eq("list_id", list.id);
    const fate = demoSongIdeaListFate({
      listIsDemo: true,
      remainingIdeaCount: count ?? 0,
    });
    if (fate === "keep_as_real") {
      await admin.from("song_idea_lists").update({ is_demo: false }).eq("id", list.id);
    } else if (fate === "delete") {
      await admin.from("song_idea_lists").delete().eq("id", list.id);
    }
  }
}

/** Remove demo-only do-not-play notes left behind when exiting Demo Mode. */
export async function clearDemoDoNotPlayNotes(admin: Admin, eventId: string): Promise<void> {
  await admin.from("planning_do_not_play_notes").delete().eq("event_id", eventId).eq("is_demo", true);
}
