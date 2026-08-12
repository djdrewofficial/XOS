import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Xpress Entertainment",
  description: "How Xpress Entertainment collects, uses, and protects your information.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-static";

/* Public web privacy policy for Xpress Entertainment (the booking/planning
   services and this site). The mobile app has its own policy at /app-privacy. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-neutral-800 dark:text-neutral-200">
      <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Last updated: August 7, 2026</p>

      <p className="mt-6 leading-relaxed">
        This policy explains how Xpress Entertainment Corp (&ldquo;Xpress,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;) collects, uses, and protects information when you request a quote, book our
        services, plan your event, or make a payment. It applies to our booking and planning services
        and this website. Our mobile app has a separate policy at{" "}
        <a className="text-violet-700 underline dark:text-violet-400" href="/app-privacy">/app-privacy</a>.
      </p>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Contact details</strong> — your name, email, phone number, and mailing address.</li>
          <li><strong>Event details</strong> — venue, date, timing, guest count, package and add-on selections, and planning content (timelines, song and music choices, questionnaire answers).</li>
          <li><strong>Payment information</strong> — the amount and status of payments. Card payments are processed by PayPal; we do not store your full card number.</li>
          <li><strong>Communications</strong> — the emails and text messages you exchange with us about your event.</li>
          <li><strong>Limited technical data</strong> — basic log and device information needed to operate the service and diagnose problems.</li>
        </ul>
      </Section>

      <Section title="How we use your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To prepare quotes and agreements, and to book and deliver your event.</li>
          <li>To process payments and send receipts and payment reminders.</li>
          <li>To communicate with you about your booking by email and (with your consent) text message.</li>
          <li>To provide the planning portal and keep your account secure.</li>
        </ul>
        <p className="mt-4">We do <strong>not</strong> sell your personal information or use it for third-party advertising.</p>
      </Section>

      <Section title="Text messages (SMS)">
        <p>
          If you opt in, we may text you about your event and payments. Message and data rates may
          apply. You can opt out at any time by replying <strong>STOP</strong>; we keep a record of
          that request so we continue to honor it.
        </p>
      </Section>

      <Section title="Service providers">
        <p>We share information only with the vendors that operate our service on our behalf:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li><strong>Supabase</strong> — secure database and authentication hosting.</li>
          <li><strong>Mailgun</strong> — transactional and event-related email.</li>
          <li><strong>HighLevel</strong> — text messaging and conversation management.</li>
          <li><strong>PayPal</strong> — online card payment processing.</li>
          <li><strong>Spotify / Apple Music</strong> — when you import a playlist, to look up the tracks you request.</li>
        </ul>
      </Section>

      <Section title="Data retention">
        <p>
          We keep your information for as long as needed to provide our services and to meet our
          legal, tax, and accounting obligations. Booking and payment records are retained as
          business records even after an event is complete.
        </p>
      </Section>

      <Section title="Your rights & choices">
        <p>
          You may request access to, correction of, or deletion of your personal information by
          emailing{" "}
          <a className="text-violet-700 underline dark:text-violet-400" href="mailto:drew@xpressdjs.com">drew@xpressdjs.com</a>.
          When you ask us to delete your data, we erase your personal details (name, contact info,
          notes) and remove your planning-portal login. We may retain anonymized booking and payment
          records where we are required to keep them for legal, tax, or accounting purposes.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Our services are intended for adults planning events and are not directed to children under
          13. We do not knowingly collect information from children.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>We may update this policy from time to time. Material changes are reflected by the &ldquo;Last updated&rdquo; date above.</p>
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
