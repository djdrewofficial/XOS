import { Section, Row, Note, CheckBoxField } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import RichTextEditor from "@/components/RichTextEditor";
import { createClient } from "@/lib/supabase/server";
import { saveJourneySettings } from "./actions";

export const dynamic = "force-dynamic";

type JourneySettings = {
  welcome_heading: string;
  welcome_body: string;
  confetti: boolean;
  proposal_flow_enabled?: boolean;
  proposal_doc_template_id?: string | null;
  proposal_layout?: string | null;
  payment_chooser?: string | null;
  vibo_intro?: string | null;
  vibo_video_url?: string | null;
  vibo_ios_url?: string | null;
  vibo_android_url?: string | null;
  vibo_web_url?: string | null;
};

export default async function JourneySettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: docTemplates }] = await Promise.all([
    supabase.from("journey_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("document_templates").select("id, name, doc_type").eq("is_active", true).order("name"),
  ]);

  if (!settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Client Journey</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
              supabase/migrations/00048_client_journey_phase_a.sql
            </code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = settings as JourneySettings;

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Client Journey</h1>
      <p className="mb-5 text-sm text-zinc-500">
        The &ldquo;welcome to the family&rdquo; page a client sees right after they sign. Payment options and the card
        fee are configured under{" "}
        <a href="/settings/payment-settings" className="font-semibold text-brand underline dark:text-brand-lighter">
          Payment Settings
        </a>
        .
      </p>

      <form action={saveJourneySettings} className="space-y-5">
        <Section title="Proposal &amp; Sign Flow">
          <Note>
            When on, the quote email&apos;s &ldquo;Review &amp; Sign&rdquo; button sends the couple to a confirm page
            (<code>/proposal</code>) where they verify their details and pick a payment plan — the contract is generated
            after that, then they sign. When off, the button generates the contract immediately and links to{" "}
            <code>/sign</code> (the old flow).
          </Note>
          <Row label="Enable Proposal Flow" hint="Collect & confirm details before generating the contract">
            <CheckBoxField name="proposal_flow_enabled" label="Enabled" defaultChecked={s.proposal_flow_enabled ?? true} />
          </Row>
          <Row label="Contract Template" hint="Default document generated once the client confirms (event types can override)">
            <select
              name="proposal_doc_template_id"
              defaultValue={s.proposal_doc_template_id ?? ""}
              className="input w-full max-w-md"
            >
              <option value="">— Select a template —</option>
              {(docTemplates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Default Layout" hint="How the confirm page is laid out (event types can override)">
            <select name="proposal_layout" defaultValue={s.proposal_layout ?? "couple"} className="input w-full max-w-md">
              <option value="couple">Couple — Partner A + Partner B</option>
              <option value="business">Business — Organization + one contact</option>
            </select>
          </Row>
          <Row label="Default Payment Chooser" hint="Who picks the plan (event types can override)">
            <select name="payment_chooser" defaultValue={s.payment_chooser ?? "client"} className="input w-full max-w-md">
              <option value="client">Client picks the plan</option>
              <option value="office">Office sets the terms</option>
            </select>
          </Row>
          <Note>
            Per-event-type overrides live in{" "}
            <a href="/settings/signing" className="font-semibold text-brand underline dark:text-brand-lighter">
              Event Type Workflows
            </a>
            .
          </Note>
        </Section>

        <Section title="Welcome Page">
          <Row label="Heading" hint="Merge tags work, e.g. <first_name>">
            <input name="welcome_heading" defaultValue={s.welcome_heading} className="input w-full" />
          </Row>
          <Row label="Confetti" hint="Pop confetti when the page opens">
            <CheckBoxField name="confetti" label="Enabled" defaultChecked={s.confetti} />
          </Row>
        </Section>

        <Section title="Welcome Message">
          <div className="p-4">
            <RichTextEditor name="welcome_body" defaultValue={s.welcome_body} />
            <Note>
              Shown above the payment options. Use merge tags (e.g. <code>&lt;first_name&gt;</code>,{" "}
              <code>&lt;event_date_long&gt;</code>) — they render per client.
            </Note>
          </div>
        </Section>

        <Section title="Vibo Planning Page">
          <Note>
            The post-payment page (<code>/vibo</code>) that explains Vibo, offers device-aware download links + the join
            link, and lets clients text a partner/planner an invite. The join link itself is set per event by your
            Zapier zap on signing.
          </Note>
          <Row label="Intro Text" hint="A short explanation of Vibo shown under the video">
            <textarea name="vibo_intro" defaultValue={s.vibo_intro ?? ""} rows={3} className="input w-full" />
          </Row>
          <Row label="Vimeo Video URL" hint="Paste the Vimeo link or player URL — leave blank to hide the video">
            <input name="vibo_video_url" defaultValue={s.vibo_video_url ?? ""} className="input w-full" placeholder="https://vimeo.com/123456789" />
          </Row>
          <Row label="iPhone Download URL">
            <input name="vibo_ios_url" defaultValue={s.vibo_ios_url ?? ""} className="input w-full" placeholder="App Store link" />
          </Row>
          <Row label="Android Download URL">
            <input name="vibo_android_url" defaultValue={s.vibo_android_url ?? ""} className="input w-full" placeholder="Google Play link" />
          </Row>
          <Row label="Web App URL">
            <input name="vibo_web_url" defaultValue={s.vibo_web_url ?? ""} className="input w-full" placeholder="https://app.vibo.dj …" />
          </Row>
        </Section>

        <div className="flex justify-end">
          <SaveButton>Save Settings</SaveButton>
        </div>
      </form>
    </div>
  );
}
