import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyVendorSuggestion, dismissVendorSuggestion } from "../actions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  kind: "merge" | "fill" | "duplicate";
  confidence: string | null;
  rationale: string | null;
  proposed: { corrected_name?: string; contact_name?: string; contact_phone?: string; contact_email?: string; matched_vendor_name?: string } | null;
  matched: { company_name: string } | null;
  ev: { contact_name: string | null; vendor: { company_name: string } | null; event: { name: string } | null } | null;
};

export default async function VendorReviewPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendor_match_suggestions")
    .select(
      "id, kind, confidence, rationale, proposed, matched:vendors!matched_vendor_id(company_name), ev:event_vendors!event_vendor_id(contact_name, vendor:vendors(company_name), event:events(name))",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="max-w-3xl">
      <Link href="/vendors" className="mb-3 inline-block text-sm text-zinc-500 hover:text-brand">← Vendors</Link>
      <h1 className="page-title mb-1">Vendor Review</h1>
      <p className="mb-5 text-sm text-zinc-500">
        GPT-matched vendors couples added against your directory. Nothing is applied until you approve it.
      </p>

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-zinc-500">Nothing to review right now. New matches appear here daily.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const their = r.ev?.vendor?.company_name ?? "Vendor";
            const fills = [
              r.proposed?.contact_name ? `contact name “${r.proposed.contact_name}”` : null,
              r.proposed?.contact_phone ? `phone ${r.proposed.contact_phone}` : null,
              r.proposed?.contact_email ? `email ${r.proposed.contact_email}` : null,
            ].filter(Boolean);
            return (
              <div key={r.id} className="card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  {r.ev?.event?.name ? <span className="font-semibold">{r.ev.event.name}</span> : null}
                  {r.confidence ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-white/10">{r.confidence} confidence</span> : null}
                </div>

                <p className="text-sm">
                  Couple added <strong>“{their}”</strong>.{" "}
                  {r.kind === "merge" && r.matched ? (
                    <>This looks like the existing vendor <strong>“{r.matched.company_name}”</strong> — merge into it{fills.length ? " and fill in " + fills.join(", ") : ""}.</>
                  ) : r.proposed?.corrected_name ? (
                    <>Suggested corrected spelling: <strong>“{r.proposed.corrected_name}”</strong>{fills.length ? "; also fill " + fills.join(", ") : ""}.</>
                  ) : fills.length ? (
                    <>We already have {fills.join(", ")} — fill it in.</>
                  ) : (
                    <>Review this entry.</>
                  )}
                </p>
                {r.rationale ? <p className="mt-1 text-xs italic text-zinc-500">{r.rationale}</p> : null}

                <div className="mt-3 flex gap-2">
                  <form action={applyVendorSuggestion.bind(null, r.id)}>
                    <button className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">Approve</button>
                  </form>
                  <form action={dismissVendorSuggestion.bind(null, r.id)}>
                    <button className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/5">Dismiss</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
