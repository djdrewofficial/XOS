import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiModule } from "@/lib/apiAuth";
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

// Every report exposes sensitive data, so each requires view access on its
// module (Settings → Permissions). The middleware permission gate doesn't cover
// /api/* routes, so this handler must enforce it for every type — not just leads.
const REPORT_MODULE: Record<string, string> = {
  received: "payments",
  scheduled: "payments",
  summary: "payments",
  monthly: "payments",
  outstanding: "payments",
  commissions: "commissions",
  leads: "reports",
};

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const supabase = await createClient();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") ?? "") || new Date().getFullYear();

  const moduleKey = REPORT_MODULE[type];
  if (!moduleKey) return new NextResponse("Unknown report", { status: 404 });
  const denied = await requireApiModule(moduleKey, "view", supabase);
  if (denied) return denied;

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
