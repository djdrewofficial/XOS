import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateTaskRules } from "@/lib/taskRules";

/* Tasks Manager engine. Driven daily by pg_cron (cron.schedule job 'xos-task-rules'
   → net.http_post here) using the shared cron_auth token, same reliable path as the
   email drain. Also accepts the Netlify CRON_SECRET. Service-role client (no session),
   so the evaluator bypasses RLS to read events/staff and insert tasks. */

export const dynamic = "force-dynamic";

async function authorized(req: Request, admin: SupabaseClient): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const { data } = await admin.from("cron_auth").select("token").limit(1).maybeSingle();
  return !!data?.token && token === data.token;
}

async function run(req: Request) {
  const admin = createAdminClient();
  if (!(await authorized(req, admin))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await evaluateTaskRules(admin);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
