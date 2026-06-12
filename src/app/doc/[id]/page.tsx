import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentShell from "@/components/DocumentShell";
import PrintButton from "@/components/PrintButton";
import { sanitizeBlocks } from "@/lib/documentBlocks";

/* Standalone document view — no app chrome, print-clean. Phase 2 adds the
   public client route (token URL) + e-sign on top of this same shell. */

export const dynamic = "force-dynamic";

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function DocumentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, event:events(id, name, event_date, client:clients(first_name, last_name))")
      .eq("id", id)
      .single(),
    supabase.from("company_settings").select("company_name, from_email").eq("id", true).maybeSingle(),
  ]);
  if (!doc) notFound();

  const ev = doc.event as unknown as { name: string; event_date: string | null; client: { first_name: string; last_name: string } | null } | null;
  const clientName = ev?.client ? `${ev.client.first_name} ${ev.client.last_name}`.trim() : null;

  return (
    <div className="min-h-screen bg-zinc-200 py-8 dark:bg-zinc-900 print:bg-white print:py-0">
      <div className="xdoc-noprint mx-auto mb-5 flex max-w-[820px] justify-end">
        <PrintButton />
      </div>
      <DocumentShell
        title={doc.title}
        docType={doc.doc_type}
        clientName={clientName}
        eventDateLabel={fmtDate(ev?.event_date)}
        companyName={cs?.company_name ?? "Xpress Entertainment"}
        companyEmail={cs?.from_email ?? null}
        blocks={sanitizeBlocks(doc.blocks)}
        signedLine={doc.signed_at ? `Signed by ${doc.signer_name} on ${new Date(doc.signed_at).toLocaleString()}` : null}
      />
    </div>
  );
}
