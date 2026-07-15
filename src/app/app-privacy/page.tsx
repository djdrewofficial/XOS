import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Xpress Entertainment App",
  description:
    "Privacy policy for the Xpress Entertainment mobile app (iOS and Android).",
};

// Public route (allowlisted in middleware). Serves as the privacy policy URL
// for the App Store and Google Play listings of the Xpress Entertainment app.
export default function AppPrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-neutral-800 dark:text-neutral-200">
      <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
        Privacy Policy — Xpress Entertainment App
      </h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Last updated: July 15, 2026
      </p>

      <p className="mt-6 leading-relaxed">
        This policy explains how Xpress Entertainment Corp (&ldquo;Xpress,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects and uses information in the
        Xpress Entertainment mobile app (the &ldquo;App&rdquo;) on iOS and
        Android. The App is a private planning tool for clients who have booked
        our services.
      </p>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account information</strong> — your name and email address,
            used to sign you in.
          </li>
          <li>
            <strong>Event planning content</strong> — the details you enter to
            plan your event: timelines, song and music selections, answers to
            planning questions, and any partner or vendor contacts you add.
          </li>
          <li>
            <strong>Limited technical data</strong> — basic device and log
            information needed to operate the App reliably and diagnose problems.
          </li>
        </ul>
      </Section>

      <Section title="How we use your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To provide the App and let you plan your event with your Xpress team.</li>
          <li>To save and sync your planning content across your devices.</li>
          <li>To authenticate you and keep your account secure.</li>
          <li>To send you account-related messages, such as password resets.</li>
        </ul>
        <p className="mt-4">
          We do <strong>not</strong> sell your personal information or use it for
          advertising.
        </p>
      </Section>

      <Section title="Service providers">
        <p>We share information only with the vendors that operate the App on our behalf:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li><strong>Supabase</strong> — secure database and authentication hosting.</li>
          <li><strong>Expo</strong> — app delivery and updates.</li>
          <li><strong>Mailgun</strong> — transactional email (e.g., password resets).</li>
          <li>
            <strong>Spotify / Apple Music</strong> — when you choose to import a
            playlist, we use their services to look up the tracks you request.
          </li>
        </ul>
      </Section>

      <Section title="Data retention">
        <p>
          We keep your account and planning content for as long as your account
          is active or as needed to provide our services. You may request
          deletion at any time.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can request access to, correction of, or deletion of your personal
          information by emailing{" "}
          <a className="text-violet-700 underline dark:text-violet-400" href="mailto:drew@xpressdjs.com">
            drew@xpressdjs.com
          </a>
          .
        </p>
      </Section>

      <Section title="Children">
        <p>
          The App is intended for adults planning events and is not directed to
          children under 13. We do not knowingly collect information from
          children.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be
          reflected by the &ldquo;Last updated&rdquo; date above.
        </p>
      </Section>

      <Section title="Contact">
        <p className="leading-relaxed">
          Xpress Entertainment Corp
          <br />
          <a className="text-violet-700 underline dark:text-violet-400" href="mailto:drew@xpressdjs.com">
            drew@xpressdjs.com
          </a>
          <br />
          <a className="text-violet-700 underline dark:text-violet-400" href="https://xpressdjs.com">
            xpressdjs.com
          </a>
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
