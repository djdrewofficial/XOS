import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note, CheckBoxField, CheckGroup } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import {
  SIGNING_FIELDS,
  DEFAULT_REQUIRED,
  sanitizeKeys,
  type SigningFieldKey,
} from "@/lib/signingRequirements";
import { saveSigningRequirements } from "./actions";

export const dynamic = "force-dynamic";

const OPTIONS = SIGNING_FIELDS.map((f) => ({ value: f.key, label: f.label }));

export default async function EventTypeWorkflowsPage() {
  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from("journey_settings")
    .select("required_signing_fields")
    .eq("id", true)
    .maybeSingle();

  if (error || !settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Event Type Workflows</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migrations{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">00049_signing_requirements.sql</code> and{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">00051_event_type_workflows.sql</code> in
            the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const global: SigningFieldKey[] = sanitizeKeys(
    (settings.required_signing_fields as string[] | null) ?? DEFAULT_REQUIRED
  );

  const [{ data: types }, { data: docTemplates }] = await Promise.all([
    supabase
      .from("event_types")
      .select("id, name, required_signing_fields, proposal_doc_template_id, proposal_layout, payment_chooser")
      .eq("is_active", true)
      .order("name"),
    supabase.from("document_templates").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-1">Event Type Workflows</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Per-event-type overrides for the confirm/sign flow. Leave a field on its default to inherit the global settings
        from{" "}
        <a href="/settings/journey" className="font-semibold text-brand underline dark:text-brand-lighter">
          Client Journey
        </a>
        . Required fields are warnings only — they never block.
      </p>

      <form action={saveSigningRequirements} className="space-y-5">
        <Section title="Global Required Fields">
          <Row label="Required Before Signing" hint="Applied to every event type unless overridden below">
            <CheckGroup name="global_fields" options={OPTIONS} selected={global} />
          </Row>
        </Section>

        <Section title="Per Event Type">
          {(types ?? []).length === 0 && (
            <Row label="">
              <span className="text-sm text-zinc-500">No active event types.</span>
            </Row>
          )}
          {(types ?? []).map((t) => {
            const override = t.required_signing_fields != null;
            const selected = override ? sanitizeKeys(t.required_signing_fields as string[]) : global;
            return (
              <Row key={t.id} label={t.name}>
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-500">Contract Template</span>
                      <select
                        name={`type_${t.id}_template`}
                        defaultValue={t.proposal_doc_template_id ?? ""}
                        className="input w-full text-sm"
                      >
                        <option value="">Inherit</option>
                        {(docTemplates ?? []).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-500">Layout</span>
                      <select
                        name={`type_${t.id}_layout`}
                        defaultValue={t.proposal_layout ?? ""}
                        className="input w-full text-sm"
                      >
                        <option value="">Inherit</option>
                        <option value="couple">Couple</option>
                        <option value="business">Business</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-500">Payment Chooser</span>
                      <select
                        name={`type_${t.id}_chooser`}
                        defaultValue={t.payment_chooser ?? ""}
                        className="input w-full text-sm"
                      >
                        <option value="">Inherit</option>
                        <option value="client">Client picks</option>
                        <option value="office">Office sets</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <CheckBoxField
                      name={`type_${t.id}_override`}
                      label="Override required fields"
                      defaultChecked={override}
                    />
                    <div className="mt-2">
                      <CheckGroup name={`type_${t.id}`} options={OPTIONS} selected={selected} />
                    </div>
                  </div>
                </div>
              </Row>
            );
          })}
          <Note>
            &ldquo;Office sets&rdquo; payment terms are chosen per event on the Financials tab (charge up front, Net 30,
            or installments).
          </Note>
        </Section>

        <div className="flex justify-end">
          <SaveButton>Save Settings</SaveButton>
        </div>
      </form>
    </div>
  );
}
