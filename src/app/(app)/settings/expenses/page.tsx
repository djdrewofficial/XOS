import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Section, Row, Note, CheckBoxField } from "@/components/SettingsForm";
import SaveButton from "@/components/SaveButton";
import Tabs from "@/components/Tabs";
import {
  saveExpenseLists,
  addExpenseCategory,
  toggleExpenseCategory,
  saveAutoMileage,
  saveVenueMileage,
  runAutoMileageNow,
} from "./actions";

export const dynamic = "force-dynamic";

type ExpenseSettings = {
  payees: string[];
  auto_mileage_enabled: boolean;
  mileage_rate: number;
  mileage_round_trip: boolean;
  mileage_category_id: string | null;
};

export default async function ExpensesSettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: paySettings }, { data: categories }, { data: venues }] =
    await Promise.all([
      supabase.from("expense_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("payment_settings").select("expense_payment_methods").eq("id", true).maybeSingle(),
      supabase.from("expense_categories").select("*").order("name"),
      supabase
        .from("venues")
        .select("id, name, city, distance_miles, auto_mileage, is_one_time")
        .eq("is_one_time", false)
        .order("name"),
    ]);

  if (!settings) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-5">Expenses</h1>
        <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
          <p>
            Run migration <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00029_expense_settings.sql</code>{" "}
            in the Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  const s = settings as ExpenseSettings;
  const sampleVenue = (venues ?? []).find((v) => v.auto_mileage && (v.distance_miles ?? 0) > 0);
  const sampleMiles = sampleVenue
    ? Number(sampleVenue.distance_miles) * (s.mileage_round_trip ? 2 : 1)
    : null;

  return (
    <div className="max-w-5xl">
      <h1 className="page-title mb-5">Expenses</h1>
      <Tabs
        tabs={[
          { id: "options", label: "Options & Categories", content: (
            <div className="space-y-8">
        <form action={saveExpenseLists} className="space-y-5">
          <Section title="Expense Option Lists">
            <Row label="Payees" hint="One per line — suggested in the Payee field when entering an expense">
              <textarea
                name="payees"
                defaultValue={(s.payees ?? []).join("\n")}
                rows={5}
                placeholder={"Shell Gas\nHome Depot\nGuitar Center"}
                className="input w-full max-w-md font-mono text-sm"
              />
            </Row>
            <Row label="Expense Payment Methods" hint="Method options for wages and expenses">
              <textarea
                name="expense_payment_methods"
                defaultValue={((paySettings?.expense_payment_methods as string[] | undefined) ?? []).join("\n")}
                rows={4}
                className="input w-full max-w-md font-mono text-sm"
              />
            </Row>
            <Note>
              Expense payment methods also live in{" "}
              <Link href="/settings/payment-settings" className="font-semibold text-brand underline dark:text-brand-lighter">
                Payment Settings
              </Link>{" "}
              — edit them in either place.
            </Note>
          </Section>
          <div className="flex justify-end">
            <SaveButton>Save Lists</SaveButton>
          </div>
        </form>

        {/* ---------- categories ---------- */}
        <Section title="Expense Categories">
          <div className="flex flex-wrap gap-2 p-4">
            {(categories ?? []).map((c) => (
              <form key={c.id} action={toggleExpenseCategory.bind(null, c.id, !c.is_active)}>
                <button
                  title={c.is_active ? "Click to deactivate" : "Click to reactivate"}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    c.is_active
                      ? "border-zinc-300 bg-zinc-50 text-zinc-700 hover:border-red-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
                      : "border-dashed border-zinc-300 text-zinc-400 line-through hover:border-emerald-400 dark:border-white/10"
                  }`}
                >
                  {c.name}
                </button>
              </form>
            ))}
          </div>
          <div className="border-t border-zinc-100 p-4 dark:border-white/[0.05]">
            <form action={addExpenseCategory} className="flex max-w-md gap-2">
              <input name="name" required placeholder="New category name" className="input flex-1" />
              <SaveButton className="btn-primary px-5 py-2 text-xs" savedLabel="Added">Add</SaveButton>
            </form>
          </div>
          <Note>Click a category to deactivate it (kept on old expenses, hidden from new ones).</Note>
        </Section>
            </div>
          ) },
          { id: "mileage", label: "Mileage", content: (
            <div className="space-y-8">
        <form action={saveAutoMileage} className="space-y-5">
          <Section title="Automatic Mileage Expenses">
            <Row label="Auto Mileage" hint="Create a mileage expense automatically when an event books at a flagged venue">
              <CheckBoxField name="auto_mileage_enabled" label="Enable Automatic Mileage Expenses" defaultChecked={s.auto_mileage_enabled} />
            </Row>
            <Row label="Rate Per Mile" hint="IRS standard rate or your own">
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                $
                <input type="number" step="0.001" name="mileage_rate" defaultValue={s.mileage_rate} className="input w-28" />
                / mile
              </label>
            </Row>
            <Row label="Round Trip" hint="Count the venue distance both ways">
              <CheckBoxField name="mileage_round_trip" label="Double the one-way distance" defaultChecked={s.mileage_round_trip} />
            </Row>
            <Row label="Expense Category">
              <select name="mileage_category_id" defaultValue={s.mileage_category_id ?? ""} className="input w-full max-w-md">
                <option value="">— None —</option>
                {(categories ?? []).filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Row>
            {sampleVenue && (
              <Note>
                Example: {sampleVenue.name} at {sampleVenue.distance_miles} mi one-way → {sampleMiles} mi ×{" "}
                ${Number(s.mileage_rate).toFixed(3)} = ${(Number(sampleMiles) * Number(s.mileage_rate)).toFixed(2)} per booked event.
              </Note>
            )}
          </Section>
          <div className="flex justify-end">
            <SaveButton>Save Mileage Settings</SaveButton>
          </div>
        </form>

        {/* ---------- per-venue toggles ---------- */}
        <Section title="Venues — Mileage Tracking">
          <Note>
            Distance is the one-way miles from your warehouse — the same field as on each{" "}
            <Link href="/venues" className="font-semibold text-brand underline dark:text-brand-lighter">venue&apos;s page</Link>.
            Turn on Auto Mileage for the venues you want tracked.
          </Note>
          <div className="hidden gap-3 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 md:grid md:grid-cols-[1.4fr_120px_180px_auto]">
            <span>Venue</span>
            <span>Distance (mi)</span>
            <span>Auto Mileage</span>
            <span />
          </div>
          {(venues ?? []).map((v) => (
            <form
              key={v.id}
              action={saveVenueMileage.bind(null, v.id)}
              className="grid items-center gap-3 border-t border-zinc-100 px-4 py-2.5 first:border-t-0 dark:border-white/[0.05] md:grid-cols-[1.4fr_120px_180px_auto]"
            >
              <Link href={`/venues/${v.id}`} className="text-sm font-semibold text-brand hover:underline dark:text-brand-lighter">
                {v.name}
                {v.city && <span className="ml-1.5 font-normal text-zinc-400">· {v.city}</span>}
              </Link>
              <input type="number" step="0.1" name="distance_miles" defaultValue={v.distance_miles ?? ""} className="input" />
              <CheckBoxField name="auto_mileage" label="Track" defaultChecked={v.auto_mileage} />
              <SaveButton className="btn-primary px-5 py-1.5 text-xs">Save</SaveButton>
            </form>
          ))}
          {(venues ?? []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">No venues yet.</p>
          )}
        </Section>

        {/* ---------- backfill ---------- */}
        <div className="card flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-zinc-500">
            New bookings get mileage expenses automatically. Use this to apply mileage to events that are{" "}
            <strong>already booked</strong> at tracked venues (each event only ever gets one auto-mileage expense).
          </p>
          <form action={runAutoMileageNow}>
            <SaveButton className="btn-ghost px-4 py-2 text-xs whitespace-nowrap" savedLabel="Done">
              ▶ Apply To Existing Events
            </SaveButton>
          </form>
        </div>
            </div>
          ) },
        ]}
      />
    </div>
  );
}
