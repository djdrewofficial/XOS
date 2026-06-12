import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import DocumentShell from "@/components/DocumentShell";
import PrintButton from "@/components/PrintButton";
import SignPanel from "@/components/SignPanel";
import { sanitizeBlocks } from "@/lib/documentBlocks";
import { signDocument } from "./actions";

/* PUBLIC client signing page — no login; the unguessable token is the key.
   Every load is recorded in document_views (the e-sign tracking panel). */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl">
        <div className="mb-3 text-3xl">📄</div>
        <p className="text-sm text-zinc-600">{message}</p>
      </div>
    </div>
  );
}

export default async function PublicSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return <Unavailable message="This document link is not valid." />;

  const supabase = createAdminClient();
  const [{ data: doc }, { data: cs }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, event:events(id, name, event_date, client:clients(first_name, last_name))")
      .eq("access_token", token)
      .maybeSingle(),
    supabase.from("company_settings").select("company_name, from_email").eq("id", true).maybeSingle(),
  ]);

  if (!doc) return <Unavailable message="This document link is not valid or has been removed." />;
  if (doc.status === "void") return <Unavailable message="This document is no longer active. Reach out to us for an updated copy." />;
  if (doc.visible_to_client === false)
    return <Unavailable message="This document isn't available right now. Reach out to us if you think this is a mistake." />;

  // log the visit (drives the e-signature tracking panel)
  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const userAgent = hdrs.get("user-agent") ?? null;
  await supabase.from("document_views").insert({ document_id: doc.id, ip, user_agent: userAgent });

  const ev = doc.event as unknown as {
    name: string;
    event_date: string | null;
    client: { first_name: string; last_name: string } | null;
  } | null;
  const clientName = ev?.client ? `${ev.client.first_name} ${ev.client.last_name}`.trim() : null;
  const companyName = cs?.company_name ?? "Xpress Entertainment";
  const signAction = signDocument.bind(null, token);

  return (
    <div className="min-h-screen bg-zinc-100 py-8 print:bg-white print:py-0">
      <div className="xdoc-noprint mx-auto mb-5 flex max-w-[820px] items-center justify-between px-4 sm:px-0">
        <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">{companyName}</span>
        <PrintButton />
      </div>

      <div className="px-4 sm:px-0">
        <DocumentShell
          title={doc.title}
          docType={doc.doc_type}
          clientName={clientName}
          eventDateLabel={fmtDate(ev?.event_date)}
          companyName={companyName}
          companyEmail={cs?.from_email ?? null}
          blocks={sanitizeBlocks(doc.blocks)}
          signedLine={doc.signed_at ? `Signed by ${doc.signer_name} on ${new Date(doc.signed_at).toLocaleString()}` : null}
        />
      </div>

      <div className="xdoc-noprint px-4 pb-12 sm:px-0">
        {doc.signed_at ? (
          <div className="mx-auto mt-6 max-w-[820px] rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-xl">
            <div className="mb-1 text-xl font-extrabold text-zinc-900">✓ Signed</div>
            <p className="text-sm text-zinc-600">
              Signed by <strong>{doc.signer_name}</strong> on {new Date(doc.signed_at).toLocaleString()}. This document
              is locked — print or save it for your records.
            </p>
          </div>
        ) : (
          <SignPanel
            action={signAction}
            clientName={clientName}
            companyName={companyName}
            documentTitle={doc.title}
          />
        )}
      </div>
    </div>
  );
}
