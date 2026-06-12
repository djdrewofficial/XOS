import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentShell from "@/components/DocumentShell";
import DocumentBuilder from "@/components/DocumentBuilder";
import { sanitizeBlocks } from "@/lib/documentBlocks";
import {
  updateDocumentBlocks,
  regenerateDocument,
  setDocumentStatus,
  deleteDocument,
} from "../actions";

export const dynamic = "force-dynamic";

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const supabase = await createClient();

  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, event:events(id, name, event_date, client:clients(first_name, last_name))")
      .eq("id", id)
      .single(),
    supabase.from("company_settings").select("company_name, from_email").eq("id", true).maybeSingle(),
  ]);
  if (!doc) notFound();

  const ev = doc.event as unknown as { id: string; name: string; event_date: string | null; client: { first_name: string; last_name: string } | null } | null;
  const clientName = ev?.client ? `${ev.client.first_name} ${ev.client.last_name}`.trim() : null;
  const blocks = sanitizeBlocks(doc.blocks);
  const locked = Boolean(doc.signed_at);
  const editing = edit === "1" && !locked;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/documents" className="text-xs font-semibold text-zinc-500 hover:underline">← Documents</Link>
          <h1 className="page-title mt-1">{doc.title}</h1>
          <p className="text-sm text-zinc-500">
            {ev && (
              <Link href={`/events/${ev.id}`} className="hover:underline">
                {ev.name || "(unnamed event)"}{ev.event_date ? ` · ${ev.event_date}` : ""}
              </Link>
            )}
            <span className="ml-2 rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
              {doc.status}
            </span>
            {locked && <span className="ml-2 text-xs">🔒 signed — locked</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/doc/${doc.id}`} target="_blank" className="btn-primary px-4 py-2 text-xs">
            Print / Save PDF
          </a>
          {!locked && (
            <>
              <Link href={editing ? `/documents/${doc.id}` : `/documents/${doc.id}?edit=1`} className="btn-ghost px-4 py-2 text-xs">
                {editing ? "Preview" : "Edit One-Off"}
              </Link>
              <form action={regenerateDocument.bind(null, id)}>
                <button className="btn-ghost px-4 py-2 text-xs" title="Re-render from the template and current event data">
                  ↻ Re-Generate
                </button>
              </form>
              <form action={setDocumentStatus.bind(null, id, doc.status === "final" ? "draft" : "final")}>
                <button className="btn-ghost px-4 py-2 text-xs">
                  {doc.status === "final" ? "Back To Draft" : "Mark Final"}
                </button>
              </form>
              <form action={deleteDocument.bind(null, id)}>
                <button className="btn-danger px-4 py-2 text-xs">Delete</button>
              </form>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <form action={updateDocumentBlocks.bind(null, id)}>
          <p className="mb-3 text-sm text-zinc-500">
            One-off edits to <strong>this document only</strong> — the template is untouched. Smart blocks stay frozen;
            use Re-Generate to refresh them from the event.
          </p>
          <DocumentBuilder initial={blocks} mode="document" />
        </form>
      ) : (
        <div className="rounded-2xl bg-zinc-200/70 p-4 sm:p-8 dark:bg-black/40">
          <DocumentShell
            title={doc.title}
            docType={doc.doc_type}
            clientName={clientName}
            eventDateLabel={fmtDate(ev?.event_date)}
            companyName={cs?.company_name ?? "Xpress Entertainment"}
            companyEmail={cs?.from_email ?? null}
            blocks={blocks}
            signedLine={doc.signed_at ? `Signed by ${doc.signer_name} on ${new Date(doc.signed_at).toLocaleString()}` : null}
          />
        </div>
      )}
    </div>
  );
}
