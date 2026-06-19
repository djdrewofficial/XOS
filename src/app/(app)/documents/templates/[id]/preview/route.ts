import { createClient } from "@/lib/supabase/server";
import { buildTemplatePreviewHtml } from "@/lib/documentHtml";

export const dynamic = "force-dynamic";

/* Branded preview of a document template, rendered against a sample event so
   merge tags + smart blocks fill in. Opened in a new tab from the editor. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return new Response("Unauthorized", { status: 401 });

  const res = await buildTemplatePreviewHtml(supabase, id);
  if (!res) return new Response("Template not found", { status: 404 });
  return new Response(res.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
