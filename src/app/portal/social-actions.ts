"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Save the logged-in client/guest's IG + TikTok handles (or nulls for "I don't
   have these"). The save_social_handles RPC is SECURITY DEFINER and scopes to
   the caller, and also marks the prompt done. */
export async function saveSocialHandles(instagram: string | null, tiktok: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_social_handles", { p_instagram: instagram, p_tiktok: tiktok });
  if (error) throw new Error(error.message);
  revalidatePath("/portal", "layout");
}
