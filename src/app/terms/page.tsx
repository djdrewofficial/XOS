import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Xpress Entertainment",
  description: "The terms that govern use of Xpress Entertainment's website and services.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-static";

/* Public terms of service. The signed booking agreement for a specific event
   governs that event and controls over these general terms where they differ. */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-neutral-800 dark:text-neutral-200">
      <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Last updated: August 7, 2026</p>

      <p className="mt-6 leading-relaxed">
        These terms govern your use of the website, planning portal, and services provided by Xpress
        Entertainment Corp (&ldquo;Xpress,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By using our
        site or services you agree to these terms. The <strong>signed booking agreement</strong> for
        your specific event governs that event and controls over these general terms where they differ.
      </p>

      <Section title="Bookings & payments">
        <ul className="list-disc space-y-2 pl-5">
          <li>An event is confirmed once you sign the booking agreement and pay any required retainer.</li>
          <li>Prices, retainers, payment schedule, and cancellation terms are set out in your booking agreement.</li>
          <li>Online payments are processed by PayPal; a small convenience fee may be shown before you pay.</li>
        </ul>
      </Section>

      <Section title="Electronic signatures & communications">
        <p>
          You agree that electronic signatures on your booking agreement are valid and binding, and
          that we may send you agreements, receipts, and event-related messages electronically by
          email and (with your consent) text message.
        </p>
      </Section>

      <Section title="Your account & planning content">
        <p>
          You are responsible for keeping your portal login secure and for the accuracy of the
          planning content you provide. Do not use the service for unlawful purposes or to upload
          content you do not have the right to share.
        </p>
      </Section>

      <Section title="Service disclaimer">
        <p>
          Our website and planning portal are provided &ldquo;as is.&rdquo; While we work to keep them
          available and accurate, we do not warrant that they will be uninterrupted or error-free. The
          services we provide at your event are governed by your booking agreement.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the extent permitted by law, our liability arising out of your use of this website and
          planning portal is limited to the amounts you have paid to us for the related event. Nothing
          in these terms limits liability that cannot be limited under applicable law.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of the State of Florida, and any dispute will be
          handled in the courts located in Broward County, Florida, unless your booking agreement says
          otherwise.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>We may update these terms from time to time. Material changes are reflected by the &ldquo;Last updated&rdquo; date above.</p>
      </Section>

      <Section title="Contact">
        <p className="leading-relaxed">
          Xpress Entertainment Corp
          <br />
          <a className="text-violet-700 underline dark:text-violet-400" href="mailto:drew@xpressdjs.com">drew@xpressdjs.com</a>
          <br />
          <a className="text-violet-700 underline dark:text-violet-400" href="https://xpressdjs.com">xpressdjs.com</a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{title}</h2>
      <div className="mt-3 leading-relaxed">{children}</div>
    </section>
  );
}
