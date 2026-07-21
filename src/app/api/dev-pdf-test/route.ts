import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { moduleAccess } from "@/lib/auth";
import { accessAtLeast } from "@/lib/permissions";
import { buildDocumentHtml } from "@/lib/documentHtml";
import { htmlToPdf } from "@/lib/pdf";

// PDF smoke test — renders the latest document to PDF. This exposes real client
// contract content, so gate it to the same access that viewing a document
// requires; middleware's permission gate doesn't cover /api/* routes.
export async function GET() {
  const supabase = await createClient();
  const access = await moduleAccess("documents", supabase);
  if (!accessAtLeast(access, "view")) return new NextResponse("Forbidden", { status: 403 });
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!doc) return new NextResponse("No document", { status: 404 });
  const built = await buildDocumentHtml(supabase, doc.id);
  if (!built) return new NextResponse("Build failed", { status: 500 });
  const pdf = await htmlToPdf(built.html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${built.title.replace(/[^\x20-\x7E]/g, "").trim() || "document"}.pdf"`,
    },
  });
}
