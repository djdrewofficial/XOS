import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { buildDocumentHtml } from "@/lib/documentHtml";
import { htmlToPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Download a generated document as a branded PDF (staff UI + agents). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireModule("documents", "view", { mode: "throw" });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const built = await buildDocumentHtml(supabase, id);
  if (!built) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const pdf = await htmlToPdf(built.html);
  const filename = `${built.title.replace(/[^\w\- &']+/g, "").trim() || "Document"}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
