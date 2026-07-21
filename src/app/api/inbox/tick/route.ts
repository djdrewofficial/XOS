import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiModule } from "@/lib/apiAuth";
import { syncHighLevelConversations } from "@/lib/highlevel";

/* Light incremental sync, polled by the open inbox UI (~25s). Session-only —
   the middleware login wall plus this inbox-access check keep it private. The
   short claim window means concurrent tabs coalesce into one real sync. */

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  // /api/* bypasses the middleware RBAC gate — gate on inbox access here.
  const denied = await requireApiModule("inbox", "view", supabase);
  if (denied) return denied;

  const result = await syncHighLevelConversations(createAdminClient(), {
    maxPages: 1,
    claimSeconds: 20,
  });
  return NextResponse.json(result);
}
