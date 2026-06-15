import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPayInfo } from "@/lib/payInfo";
import WelcomePayment from "@/components/WelcomePayment";

/* PUBLIC payment step — where the sign flow forwards a newly booked client to
   set up autopay or make a one-time payment. The celebration + planning portal
   (Vibo) lives on the next screen, after payment. */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:p-8">
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

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();
  const info = await loadPayInfo(supabase, token);

  if (!info) {
    return (
      <Shell>
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          This link isn&apos;t valid. Please reach out to us for an updated one.
        </p>
      </Shell>
    );
  }

  const first = info.firstName ?? "there";
  const paidInFull = info.balance <= 0;

  return (
    <Shell>
      <div className="mb-5 text-center">
        <h1 className="text-xl font-extrabold text-zinc-900 dark:text-white">
          {paidInFull ? `You're all set, ${first}! 🎉` : `You're booked, ${first}! 🎉`}
        </h1>
        {!paidInFull && (
          <p className="mt-1 text-sm text-zinc-500">Let&apos;s take care of your payment to lock everything in.</p>
        )}
      </div>

      {paidInFull ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="text-2xl">✅</div>
          <div className="mt-1 font-bold text-emerald-800 dark:text-emerald-300">You&apos;re all paid up</div>
          <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
            Nothing is owed right now. We&apos;ll be in touch with your planning details next!
          </div>
        </div>
      ) : (
        <>
          <dl className="mb-5 space-y-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex justify-between"><dt className="text-zinc-500">Total Investment</dt><dd className="font-semibold">{money(info.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Paid so far</dt><dd className="text-emerald-600 dark:text-emerald-400">{money(info.paid)}</dd></div>
            <div className="flex justify-between border-t border-zinc-200 pt-1.5 dark:border-white/10">
              <dt className="font-semibold text-zinc-700 dark:text-zinc-200">Balance</dt>
              <dd className="font-bold text-zinc-900 dark:text-white">{money(info.balance)}</dd>
            </div>
          </dl>

          <WelcomePayment
            token={token}
            paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? null}
            suggested={info.suggested}
            balance={info.balance}
            feePct={info.settings.paypalFeePct}
            paypalEnabled={info.settings.onlinePayEnabled && info.settings.paypalEnabled}
            zelleEnabled={info.settings.onlinePayEnabled && info.settings.zelleEnabled}
            zelleDisplayName={info.settings.zelleDisplayName}
            zelleHandle={info.settings.zelleHandle}
            zelleMemo={info.settings.zelleMemo}
          />

          <p className="mt-4 text-center text-[11px] text-zinc-400">
            A receipt is emailed once your payment completes. Your planning portal details are coming next.
          </p>
        </>
      )}
    </Shell>
  );
}
