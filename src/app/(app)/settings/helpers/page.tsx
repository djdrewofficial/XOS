import { createClient } from "@/lib/supabase/server";
import { createHelper, toggleHelper, deleteHelper } from "./actions";

export const dynamic = "force-dynamic";

type HelperAction = { type: string; field?: string; value?: string; to?: string };

function describeAction(a: HelperAction, statusNames: Map<string, string>, templateNames: Map<string, string>) {
  switch (a.type) {
    case "set_status":
      return `Set status → ${statusNames.get((a as { status_id?: string }).status_id ?? "") ?? "?"}`;
    case "set_date":
      return `Set ${a.field} = ${a.value}`;
    case "send_email":
      return `Email client: ${templateNames.get((a as { template_id?: string }).template_id ?? "") ?? "?"}`;
    case "add_note":
      return "Add note";
    default:
      return a.type;
  }
}

export default async function HelpersPage() {
  const supabase = await createClient();
  const [{ data: helpers }, { data: statuses }, { data: templates }] = await Promise.all([
    supabase.from("booking_helpers").select("*").order("position"),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("email_templates").select("id, name, group_name").eq("is_active", true).order("group_name"),
  ]);

  const statusNames = new Map((statuses ?? []).map((s) => [s.id as string, s.name as string]));
  const templateNames = new Map((templates ?? []).map((t) => [t.id as string, t.name as string]));

  const input =
    "input w-full";
  const label = "label-xs";

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Booking Helpers</h1>
      <p className="mb-5 text-sm text-zinc-500">
        One-click action bundles on the event record — set status, stamp dates, email the client, leave a note.
        Conditions control when each button is visible.
      </p>

      <div className="mb-8 card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Button</th>
              <th className="px-4 py-2">Actions</th>
              <th className="px-4 py-2">Conditions</th>
              <th className="px-4 py-2 text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {(helpers ?? []).map((h) => (
              <tr key={h.id} className={`row ${!h.is_active ? "opacity-40" : ""}`}>
                <td className="px-4 py-2">{h.position}</td>
                <td className="px-4 py-2">
                  <span
                    className="rounded px-2.5 py-1 text-xs font-bold"
                    style={{ backgroundColor: h.button_bg, color: h.button_fg }}
                  >
                    {h.button_text}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {(h.actions as HelperAction[]).map((a, i) => (
                    <div key={i}>• {describeAction(a, statusNames, templateNames)}</div>
                  ))}
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  {h.visible_status_ids.length > 0 && (
                    <div>Status: {h.visible_status_ids.map((id: string) => statusNames.get(id)).join(", ")}</div>
                  )}
                  {h.hide_if_payment_made && <div>Hide if payment made</div>}
                  {h.hide_if_already_ran && <div>Run once per event</div>}
                  {h.visible_status_ids.length === 0 && !h.hide_if_payment_made && !h.hide_if_already_ran && "Always visible"}
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  <form action={toggleHelper.bind(null, h.id, !h.is_active)} className="inline">
                    <button className="font-semibold text-brand dark:text-brand-lighter hover:underline">
                      {h.is_active ? "Disable" : "Enable"}
                    </button>
                  </form>
                  <form action={deleteHelper.bind(null, h.id)} className="ml-3 inline">
                    <button className="font-semibold text-red-600 dark:text-red-400 hover:underline">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="card-title">Add Booking Helper</h2>
      <form action={createHelper} className="space-y-5 card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className={label}>Title</label>
            <input name="title" required className={input} />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Button Text</label>
            <input name="button_text" className={input} placeholder="defaults to title" />
          </div>
          <div>
            <label className={label}>Button Color</label>
            <input type="color" name="button_bg" defaultValue="#97CC9A" className="h-10 w-full rounded-md border border-zinc-300" />
          </div>
          <div>
            <label className={label}>Text Color</label>
            <input type="color" name="button_fg" defaultValue="#000000" className="h-10 w-full rounded-md border border-zinc-300" />
          </div>
          <div>
            <label className={label}>Position</label>
            <input type="number" name="position" defaultValue={0} className={input} />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase text-zinc-500">Actions (run in order)</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={label}>1 · Set Status To</label>
              <select name="action_status_id" className={input}>
                <option value="">(don&apos;t change status)</option>
                {(statuses ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>3 · Send Email Template To Client</label>
              <select name="action_template_id" className={input}>
                <option value="">(don&apos;t send email)</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.group_name} — {t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-5">
            {(["initial_contact_date", "contract_sent_date", "contract_due_date", "contract_signed_date", "quote_sent_date"] as const).map(
              (f) => (
                <div key={f}>
                  <label className={label}>2 · {f.replace(/_/g, " ")}</label>
                  <input
                    name={`date_${f}`}
                    placeholder='"today" or "+7"'
                    className={input}
                  />
                </div>
              )
            )}
          </div>
          <div className="mt-3">
            <label className={label}>4 · Add Note (supports merge tags)</label>
            <input name="action_note" className={input} placeholder="Contract sent to <first_name>." />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase text-zinc-500">Visibility Conditions</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {(statuses ?? []).map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 dark:border-white/10 px-2 py-1 text-xs"
              >
                <input type="checkbox" name="visible_status_ids" value={s.id} />
                <span className="rounded px-1.5 py-0.5 font-semibold" style={{ backgroundColor: s.color, color: s.text_color }}>
                  {s.name}
                </span>
              </label>
            ))}
          </div>
          <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">Leave all unchecked = visible for every status.</p>
          <label className="mr-5 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="hide_if_payment_made" /> Hide if a payment has been made
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="hide_if_already_ran" /> Only run once per event
          </label>
        </div>

        <button className="btn-primary">
          Create Helper
        </button>
      </form>
    </div>
  );
}
