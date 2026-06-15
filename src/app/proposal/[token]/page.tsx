import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEventBundle } from "@/lib/documentRender";
import { quoteSummaryHtml } from "@/lib/signing";
import { resolveJourney, officePlan, type BillingTerms } from "@/lib/journeyConfig";
import { buildScheduleRows } from "@/lib/paymentSchedule";
import ProposalForm from "@/components/ProposalForm";

/* PUBLIC confirm-&-choose-plan page. The quote email's "Review & Sign" button
   lands the couple here: they confirm/edit their details, pick a payment plan
   (and opt into autopay), then we generate the contract and send them to sign. */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:p-8">
        <div className="mb-5 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Xpress Entertainment" className="h-10 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Xpress Entertainment" className="hidden h-10 dark:block" />
        </div>
        {children}
      </div>
    </div>
  );
}

type ClientLite = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cell_phone?: string | null;
  organization?: string | null;
} | null;

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, event_date, setup_time, start_time, end_time, deposit_value, venue_id, package_id, event_type_id, billing_terms, billing_terms_count"
    )
    .eq("pay_token", token)
    .maybeSingle();

  if (!event) {
    return (
      <Shell>
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          This link isn&apos;t valid. Please reach out to us for an updated one.
        </p>
      </Shell>
    );
  }

  // already signed? skip straight to the welcome/payment page
  const { data: signedDoc } = await supabase
    .from("documents")
    .select("id")
    .eq("event_id", event.id)
    .eq("doc_type", "contract")
    .not("signed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (signedDoc) redirect(`/welcome/${token}`);

  const [bundle, { data: ecs }, venueRes, pkgRes, typeRes, jsRes] = await Promise.all([
    loadEventBundle(supabase, event.id),
    supabase
      .from("event_clients")
      .select("is_primary, created_at, client:clients(first_name, last_name, email, cell_phone, organization)")
      .eq("event_id", event.id)
      .order("is_primary", { ascending: false })
      .order("created_at"),
    event.venue_id
      ? supabase.from("venues").select("name, address").eq("id", event.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.package_id
      ? supabase.from("packages").select("allowed_splits, payment_terms, payment_terms_days").eq("id", event.package_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.event_type_id
      ? supabase
          .from("event_types")
          .select("proposal_doc_template_id, proposal_layout, payment_chooser")
          .eq("id", event.event_type_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("journey_settings")
      .select("proposal_doc_template_id, proposal_layout, payment_chooser")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const primary = (ecs ?? []).find((e) => e.is_primary) ?? (ecs ?? [])[0] ?? null;
  const partnerB = (ecs ?? []).find((e) => !e.is_primary) ?? null;
  const a = (primary?.client ?? null) as ClientLite;
  const b = (partnerB?.client ?? null) as ClientLite;

  const venue = (venueRes.data ?? null) as { name?: string | null; address?: string | null } | null;
  const pkg = (pkgRes.data ?? null) as { allowed_splits?: number[] | null; payment_terms?: string | null; payment_terms_days?: number | null } | null;
  const allowedSplits = pkg?.allowed_splits?.length ? pkg.allowed_splits : [1, 2, 3];
  const terms = (pkg?.payment_terms as "days_before" | "net_days_after") ?? "days_before";
  const termsDays = pkg?.payment_terms_days ?? 30;

  // resolve this event type's workflow (template + layout + who picks the plan)
  const journey = resolveJourney(typeRes.data, jsRes.data);
  const total = bundle?.total ?? 0;
  const deposit = Number(event.deposit_value ?? 0);

  // office-set payment terms → a fixed, read-only schedule the client just sees
  const today = new Date().toISOString().slice(0, 10);
  const officeRows =
    journey.chooser === "office"
      ? buildScheduleRows({
          total,
          deposit,
          eventDate: event.event_date ?? null,
          terms,
          termsDays,
          plan: officePlan(event.billing_terms as BillingTerms | null, event.billing_terms_count ?? 2),
          today,
        })
      : [];
  const officeLabel =
    event.billing_terms === "net_30"
      ? "Your balance is due Net 30 — an invoice will follow."
      : event.billing_terms === "installments"
        ? "Your payments are scheduled as follows."
        : "Your balance is due in full up front.";

  const firstName = a?.first_name ?? "there";

  return (
    <Shell>
      <div className="mb-5 text-center">
        <h1 className="text-xl font-extrabold text-zinc-900 dark:text-white">
          You&apos;re almost there, {firstName}! 🎉
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Take a moment to confirm your details and choose the payment plan that works best for you. Then we&apos;ll
          have you sign and you&apos;re officially booked.
        </p>
      </div>

      <ProposalForm
        token={token}
        layout={journey.layout}
        mode={journey.chooser}
        a={{
          first: a?.first_name ?? "",
          last: a?.last_name ?? "",
          email: a?.email ?? "",
          cell: a?.cell_phone ?? "",
        }}
        b={{
          first: b?.first_name ?? "",
          last: b?.last_name ?? "",
          email: b?.email ?? "",
          cell: b?.cell_phone ?? "",
        }}
        organization={a?.organization ?? ""}
        venue={{ name: venue?.name ?? "", address: venue?.address ?? "" }}
        timing={{
          date: event.event_date ?? "",
          setup: event.setup_time ?? "",
          start: event.start_time ?? "",
          end: event.end_time ?? "",
        }}
        quoteHtml={bundle ? quoteSummaryHtml(bundle) : ""}
        total={total}
        deposit={deposit}
        allowedSplits={allowedSplits}
        terms={terms}
        termsDays={termsDays}
        officeRows={officeRows}
        officeLabel={officeLabel}
      />
    </Shell>
  );
}
