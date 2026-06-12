import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadEventBundle } from "@/lib/documentRender";
import { agreementEmailHtml, appUrl } from "@/lib/signing";

// TEMPORARY dev-only preview of the agreement email — delete before deploy.
export async function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("*").limit(1).maybeSingle();
  if (!doc) return new NextResponse("No document to preview", { status: 404 });
  const bundle = await loadEventBundle(supabase, doc.event_id);
  if (!bundle) return new NextResponse("No bundle", { status: 404 });
  const html = agreementEmailHtml({
    bundle,
    docLabel: "Booking Agreement",
    firstName: bundle.event.client?.first_name ?? "there",
    buttonUrl: `${appUrl()}/sign/${doc.access_token}`,
    companyName: "Xpress Entertainment",
  });
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}
