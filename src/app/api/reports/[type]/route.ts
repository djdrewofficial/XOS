import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderReportPdf, type ReportDoc } from "@/lib/reportPdf";
import {
  buildReceived,
  buildScheduled,
  buildSummary,
  buildMonthly,
  buildOutstanding,
  buildCommissions,
  buildLeads,
} from "@/lib/reports/build";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const supabase = await createClient();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") ?? "") || new Date().getFullYear();

  // admin-only reports
  if (type === "leads") {
    const { data: auth } = await supabase.auth.getUser();
    const { data: me } = auth?.user
      ? await supabase.from("employees").select("permission_tier").eq("auth_user_id", auth.user.id).maybeSingle()
      : { data: null };
    const tier = (me?.permission_tier as string | undefined) ?? "master_admin";
    if (tier !== "master_admin" && tier !== "admin") return new NextResponse("Forbidden", { status: 403 });
  }

  let doc: ReportDoc;
  switch (type) {
    case "received": doc = await buildReceived(supabase, year); break;
    case "scheduled": doc = await buildScheduled(supabase, year); break;
    case "summary": doc = await buildSummary(supabase, year); break;
    case "monthly": doc = await buildMonthly(supabase); break;
    case "outstanding": doc = await buildOutstanding(supabase); break;
    case "commissions": doc = await buildCommissions(supabase, year); break;
    case "leads":
      doc = await buildLeads(supabase, { year, type: url.searchParams.get("type"), status: url.searchParams.get("status") });
      break;
    default:
      return new NextResponse("Unknown report", { status: 404 });
  }

  const pdf = await renderReportPdf(supabase, doc);
  const fname = doc.title.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").toLowerCase() || "report";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fname}.pdf"`,
    },
  });
}
