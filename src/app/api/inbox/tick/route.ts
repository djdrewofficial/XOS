import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncHighLevelConversations } from "@/lib/highlevel";

/* Light incremental sync, polled by the open inbox UI (~25s). Session-only —
   the middleware login wall plus this user check keep it private. The short
   claim window means concurrent tabs coalesce into one real sync. */

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await syncHighLevelConversations(createAdminClient(), {
    maxPages: 1,
    claimSeconds: 20,
  });
  return NextResponse.json(result);
}
