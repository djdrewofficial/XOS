"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModule } from "@/lib/auth";
import { syncRecent, firefliesConfigured } from "@/lib/fireflies";

/** Backfill: pull recent meetings from Fireflies and auto-match by email. */
export async function syncFirefliesNow(): Promise<{ imported: number; error?: string }> {
  const supabase = await createClient();
  await requireModule("settings", "edit", { mode: "throw", supabase });
  if (!firefliesConfigured()) return { imported: 0, error: "FIREFLIES_API_KEY is not set on the server." };
  try {
    const admin = createAdminClient();
    const res = await syncRecent(admin, { limit: 50 });
    revalidatePath("/settings/fireflies");
    return res;
  } catch (e) {
    return { imported: 0, error: e instanceof Error ? e.message : "Sync failed." };
  }
}
