import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { updateJourneyType, deleteJourneyType } from "../actions";

export const dynamic = "force-dynamic";

const STEPS: { name: string; label: string; hint: string }[] = [
  { name: "step_confirm_info", label: "Confirm information", hint: "Client verifies names, contact, date/times, venue." },
  { name: "step_sign_agreement", label: "Sign an agreement", hint: "Client e-signs the agreement selected below." },
  { name: "step_payment", label: "Take a payment", hint: "Off for venue-partner journeys (the venue bills the client)." },
  { name: "step_app_onboarding", label: "App onboarding", hint: "After signing, email the client their login + app download links." },
  { name: "step_book_meeting", label: "Book a meeting", hint: "Show the calendar embed below on the final page." },
  { name: "step_planner", label: "Planner access", hint: "Client can plan songs/timeline in the app." },
];

type JourneyRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  agreement_template_id: string | null;
  calendar_embed: string | null;
  final_page_heading: string | null;
  final_page_body: string | null;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

export default async function EditJourneyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("settings", "view", { mode: "redirect" });
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: journey }, { data: templates }] = await Promise.all([
    supabase.from("journey_types").select("*").eq("id", id).maybeSingle(),
    supabase.from("document_templates").select("id, name").eq("doc_type", "contract").eq("is_active", true).order("name"),
  ]);
  if (!journey) notFound();
  const j = journey as JourneyRow;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <Link href="/settings/journeys" className="text-sm text-zinc-500 hover:text-brand">← Journey Types</Link>
      </div>
      <h1 className="page-title mb-5">{j.name}{j.is_default && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 align-middle text-xs font-bold uppercase text-brand">Default</span>}</h1>

      <form action={updateJourneyType.bind(null, id)} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Journey name"><input name="name" defaultValue={j.name} required className="input w-full" /></Field>
          <label className="flex items-end gap-2 pb-2">
            <input type="checkbox" name="is_active" defaultChecked={j.is_active} className="size-4 accent-brand-light" />
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Active</span>
          </label>
        </div>
        <Field label="Description (internal)"><textarea name="description" defaultValue={j.description ?? ""} rows={2} className="input w-full" /></Field>

        <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">Steps in this journey</p>
          <div className="space-y-2.5">
            {STEPS.map((s) => (
              <label key={s.name} className="flex items-start gap-3">
                <input type="checkbox" name={s.name} defaultChecked={!!j[s.name]} className="mt-0.5 size-4 accent-brand-light" />
                <span>
                  <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{s.label}</span>
                  <span className="block text-[11px] text-zinc-400">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Field label="Agreement to sign" hint="The contract/agreement template this journey's clients e-sign. Leave blank to use the normal per-event-type contract.">
          <select name="agreement_template_id" defaultValue={j.agreement_template_id ?? ""} className="input w-full">
            <option value="">(use the normal contract)</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Booking calendar embed" hint="Paste an embed snippet (e.g. HighLevel / Calendly). Shown on the final page when 'Book a meeting' is on.">
          <textarea name="calendar_embed" defaultValue={j.calendar_embed ?? ""} rows={4} className="input w-full font-mono text-xs" placeholder="<iframe src=… ></iframe>" />
        </Field>

        <div className="grid grid-cols-1 gap-4">
          <Field label="Final page heading" hint="Shown after they sign (e.g. “You're all set!”)."><input name="final_page_heading" defaultValue={j.final_page_heading ?? ""} className="input w-full" /></Field>
          <Field label="Final page message"><textarea name="final_page_body" defaultValue={j.final_page_body ?? ""} rows={2} className="input w-full" /></Field>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button type="submit" className="btn-primary px-8">Save</button>
        </div>
      </form>

      {!j.is_default && (
        <form action={deleteJourneyType.bind(null, id)} className="mt-8 border-t border-zinc-200 pt-4 dark:border-white/10">
          <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">Delete this journey</button>
        </form>
      )}
    </div>
  );
}
