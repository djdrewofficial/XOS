import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEventBundle } from "@/lib/documentRender";
import { appUrl, quoteSummaryHtml, paymentPlanHtml } from "@/lib/signing";
import { loadEventJourney } from "@/lib/eventJourney";

/* PUBLIC proposal cover — the email-can't-reach-them fallback. Renders the same
   content as the proposal email (quote + payment plan) on the web, then a
   "Continue to Sign the Booking Agreement" button hands off to /proposal/[token]
   (the normal confirm-&-sign flow). The short link (/p/<code>) points here. */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("events")
    .select("id, journey_type_id")
    .eq("pay_token", token)
    .maybeSingle();

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
        <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
          This link isn&apos;t valid. Please reach out to us for an updated one.
        </p>
      </div>
    );
  }

  // Already signed → skip the offer and go where the proposal flow would.
  const { data: signedDoc } = await admin
    .from("documents")
    .select("id")
    .eq("event_id", event.id)
    .eq("doc_type", "contract")
    .not("signed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (signedDoc) {
    const jt = await loadEventJourney(admin, event.journey_type_id);
    redirect(jt.step_payment ? `/welcome/${token}` : `/vibo/${token}`);
  }

  const continueUrl = `/proposal/${token}`;

  // The proposal email = the active BOOKING AGREEMENT template with the full quote.
  // Contract Notes ride along inside <quote_summary> (rendered under Your Package).
  const [{ data: tpl }, bundle] = await Promise.all([
    admin
      .from("email_templates")
      .select("body_html")
      .eq("is_active", true)
      .eq("group_name", "BOOKING AGREEMENT")
      .ilike("body_html", "%quote_summary%")
      .limit(1)
      .maybeSingle(),
    loadEventBundle(admin, event.id),
  ]);

  let content = "";
  if (tpl?.body_html) {
    const { data: rendered } = await admin.rpc("render_merge_tags", { p_event_id: event.id, p_template: tpl.body_html });
    content = (rendered as string | null) ?? tpl.body_html;
  }
  if (!content) {
    // fallback cover if the email template isn't found
    content =
      `<p>Here's your proposal — review the details below, then continue to sign your Booking Agreement.</p>` +
      `<quote_summary><payment_plan>`;
  }

  // Fill the quote + payment-plan blocks (same builders the email uses).
  if (bundle) {
    content = content.split("<quote_summary>").join(quoteSummaryHtml(bundle));
    content = content.split("<payment_plan>").join(paymentPlanHtml(bundle));
  } else {
    content = content.split("<quote_summary>").join("").split("<payment_plan>").join("");
  }
  // The cover has its own Continue button — neutralize the email's CTAs so the
  // client isn't shown two competing sign/pay buttons.
  content = content.split("<review_sign_button>").join("").split("<payment_button>").join("");
  content = content.split("<review_sign_link>").join(`${appUrl()}${continueUrl}`);
  content = content.split("<payment_link>").join(`${appUrl()}${continueUrl}`);

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-28">
        {/* white "email" card so the email-styled content reads in both themes */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
          <div className="bg-gradient-to-r from-brand to-brand-light p-7 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="Xpress Entertainment" className="mx-auto h-9" />
          </div>
          <div
            className="proposal-body px-6 py-7 sm:px-8"
            style={{ color: "#2c2c33", fontSize: "15px", lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        </div>
        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Having trouble? Reply to us and we&apos;ll help you get booked.
        </p>
      </div>

      {/* sticky CTA → the normal confirm & sign flow */}
      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-2xl justify-center">
          <a
            href={continueUrl}
            className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-light px-8 py-3.5 text-center text-base font-bold text-white shadow-lg shadow-brand/30 sm:w-auto"
          >
            Continue to Sign the Booking Agreement →
          </a>
        </div>
      </div>
    </div>
  );
}
