import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createHelper, toggleHelper, deleteHelper, moveHelper, duplicateHelper } from "./actions";
import HelperFormFields from "@/components/HelperFormFields";

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
  const [
    { data: helpers },
    { data: statuses },
    { data: templates },
    { data: eventTypes },
    { data: sources },
    { data: employees },
    { data: dateDefs },
  ] = await Promise.all([
    supabase.from("booking_helpers").select("*").order("position"),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("email_templates").select("id, name, group_name").eq("is_active", true).order("group_name"),
    supabase.from("event_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("inquiry_sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("is_active", true).order("first_name"),
    supabase.from("custom_date_definitions").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  const statusNames = new Map((statuses ?? []).map((s) => [s.id as string, s.name as string]));
  const templateNames = new Map((templates ?? []).map((t) => [t.id as string, t.name as string]));

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Booking Helpers</h1>
      <p className="mb-5 text-sm text-zinc-500">
        One-click action bundles on the event record — set status, stamp dates, email the client, leave a note.
        Conditions control when each button is visible. <strong>The order here is the order the buttons appear on events</strong> — use ↑ ↓ to rearrange.
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
            {(helpers ?? []).map((h, idx) => (
              <tr key={h.id} className={`row ${!h.is_active ? "opacity-40" : ""}`}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="mr-1.5 text-xs text-zinc-500">{idx + 1}</span>
                  <form action={moveHelper.bind(null, h.id, "up")} className="inline">
                    <button disabled={idx === 0} className="rounded px-1 text-xs text-zinc-500 hover:bg-black/10 disabled:opacity-25 dark:hover:bg-white/10">↑</button>
                  </form>
                  <form action={moveHelper.bind(null, h.id, "down")} className="inline">
                    <button disabled={idx === (helpers ?? []).length - 1} className="rounded px-1 text-xs text-zinc-500 hover:bg-black/10 disabled:opacity-25 dark:hover:bg-white/10">↓</button>
                  </form>
                </td>
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
                <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                  <Link href={`/settings/helpers/${h.id}`} className="font-semibold text-brand dark:text-brand-lighter hover:underline">
                    Edit
                  </Link>
                  <form action={duplicateHelper.bind(null, h.id)} className="ml-3 inline">
                    <button className="font-semibold text-zinc-600 dark:text-zinc-400 hover:underline">Duplicate</button>
                  </form>
                  <form action={toggleHelper.bind(null, h.id, !h.is_active)} className="ml-3 inline">
                    <button className="font-semibold text-zinc-600 dark:text-zinc-400 hover:underline">
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
      <form action={createHelper} className="card p-5">
        <HelperFormFields
          d={{}}
          statuses={statuses ?? []}
          templates={templates ?? []}
          eventTypes={eventTypes ?? []}
          sources={sources ?? []}
          employees={(employees ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }))}
          dateDefs={dateDefs ?? []}
          otherHelpers={(helpers ?? []).map((h) => ({ id: h.id, title: h.title }))}
        />
        <button className="btn-primary mt-6">Create Helper</button>
      </form>
    </div>
  );
}
