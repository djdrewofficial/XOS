"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import type { SignResult } from "@/app/sign/[token]/actions";

/* The e-sign action panel on the public document page. ESIGN/UETA flow:
   typed full name (intent) + explicit consent checkbox + clearly labeled
   sign button. The thank-you state handles the after-sign forward URL. */

function SignButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-light px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-brand/40 transition-all hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Signing…" : "Sign Agreement"}
    </button>
  );
}

export default function SignPanel({
  action,
  clientName,
  companyName,
  documentTitle,
}: {
  action: (prev: SignResult | null, formData: FormData) => Promise<SignResult>;
  clientName: string | null;
  companyName: string;
  documentTitle: string;
}) {
  const [state, formAction] = useActionState(action, null);

  const signed = state?.ok === true;
  const forward = signed ? state?.afterSignUrl : null;

  // forward to the payment page promptly (single timer is more reliable on
  // mobile than an interval countdown, which throttles when the tab blurs)
  useEffect(() => {
    if (!signed || !forward) return;
    const t = setTimeout(() => {
      window.location.href = forward;
    }, 1500);
    return () => clearTimeout(t);
  }, [signed, forward]);

  if (signed) {
    return (
      <div className="mx-auto mt-6 max-w-[820px] rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
        <h2 className="mb-2 text-2xl font-extrabold text-zinc-900">Thank you — you&apos;re booked in!</h2>
        <p className="mx-auto mb-1 max-w-md text-sm text-zinc-600">
          Your <strong>{documentTitle}</strong> is signed and locked. A copy is on its way to your email — you can
          also print or save this page as a PDF.
        </p>
        <p className="text-sm font-semibold text-zinc-700">
          {forward ? "Taking you to your payment…" : "We can't wait to celebrate with you! 🎉"}
        </p>
        {forward && (
          <a
            href={forward}
            className="mt-5 inline-block rounded-xl bg-gradient-to-r from-brand to-brand-light px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand/40"
          >
            Continue to payment →
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-[820px] rounded-2xl border border-zinc-200 bg-white p-7 shadow-xl">
      <h2 className="mb-1 text-lg font-extrabold text-zinc-900">Ready to make it official?</h2>
      <p className="mb-5 text-sm text-zinc-500">
        Review the {documentTitle.toLowerCase().includes("agreement") ? "agreement" : "document"} above, then sign
        below.
      </p>
      <form action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Type your full legal name
          </label>
          <input
            name="signer_name"
            required
            defaultValue={clientName ?? ""}
            placeholder="e.g. Jordan Alexander Smith"
            className="w-full rounded-lg border border-zinc-300 px-4 py-3 font-[cursive] text-xl text-zinc-900 focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/30"
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-zinc-50 p-3.5 text-sm text-zinc-700">
          <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-light" />
          <span>
            I agree to do business electronically with {companyName}, and by typing my name and clicking{" "}
            <strong>Sign Agreement</strong> I am electronically signing this document and agree to be bound by its
            terms.
          </span>
        </label>
        {state?.error && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">{state.error}</p>
        )}
        <SignButton />
        <p className="text-center text-[11px] text-zinc-400">
          Your signature is recorded with a timestamp, IP address, and a cryptographic fingerprint of this document.
        </p>
      </form>
    </div>
  );
}
