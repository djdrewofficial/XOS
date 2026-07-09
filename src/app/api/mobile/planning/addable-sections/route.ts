import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventRole } from "@/lib/planning";

/* Sections the couple can add from the app: template sections staff flagged
   `client_addable`, from the event's own template, minus ones already on the
   event. Host/staff only. JWT-verified via the /api/mobile/ prefix. */

export async function GET(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!eventId) return NextResponse.json({ error: "Missing event." }, { status: 400 });

  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;
  const { data: acct } = await rls.from("accounts").select("account_type").eq("auth_user_id", uid).maybeSingle();
  const accountType = (acct?.account_type as "staff" | "client" | "event_guest" | undefined) ?? "staff";
  const role = await resolveEventRole(rls, uid, accountType, eventId);
  if (role !== "staff" && role !== "host") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Resolve the template the event was built from (existing sections point at it;
  // fall back to the event's explicit assignment).
  let templateId: string | null = null;
  const { data: seed } = await admin
    .from("planning_sections")
    .select("template_section_id")
    .eq("event_id", eventId)
    .not("template_section_id", "is", null)
    .limit(1);
  if (seed?.[0]?.template_section_id) {
    const { data: ts } = await admin
      .from("planning_template_sections")
      .select("template_id")
      .eq("id", seed[0].template_section_id as string)
      .maybeSingle();
    templateId = (ts?.template_id as string | undefined) ?? null;
  }
  if (!templateId) {
    const { data: ev } = await admin.from("events").select("planning_template_id").eq("id", eventId).maybeSingle();
    templateId = (ev?.planning_template_id as string | undefined) ?? null;
  }
  if (!templateId) return NextResponse.json({ ok: true, sections: [] });

  const [{ data: addable }, { data: present }] = await Promise.all([
    admin
      .from("planning_template_sections")
      .select("id, title, icon")
      .eq("template_id", templateId)
      .eq("client_addable", true)
      .eq("section_type", "timeline")
      .order("sort_order"),
    admin
      .from("planning_sections")
      .select("template_section_id")
      .eq("event_id", eventId)
      .is("deleted_by_host_at", null)
      .not("template_section_id", "is", null),
  ]);

  const have = new Set((present ?? []).map((r) => r.template_section_id as string));
  const sections = (addable ?? [])
    .filter((s) => !have.has(s.id as string))
    .map((s) => ({ templateSectionId: s.id, title: s.title, icon: s.icon }));

  return NextResponse.json({ ok: true, sections });
}
