import { createClient } from "@/lib/supabase/server";
import { createTemplate, deleteTemplate, sendQueuedEmails } from "./actions";

export const dynamic = "force-dynamic";

const MERGE_TAGS = [
  "<first_name>", "<last_name>", "<client_name>", "<client_email>", "<client_cell>",
  "<event_name>", "<event_type>", "<event_date_long>", "<event_date_short>",
  "<event_date_countdown>", "<venue_name>", "<package_name>", "<total_fee>",
  "<balance_due>", "<payments_received>", "<deposit_value>", "<start_time>",
  "<end_time>", "<company_name>", "<current_date>",
];

export default async function EmailPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: log }] = await Promise.all([
    supabase.from("email_templates").select("*").eq("is_active", true).order("group_name").order("name"),
    supabase.from("email_log").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  const mailgunConfigured = !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
  const queuedCount = (log ?? []).filter((m) => m.status === "queued").length;

  const groups = [...new Set((templates ?? []).map((t) => t.group_name))];

  const input =
    "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none bg-white";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500";

  return (
    <div className="max-w-5xl">
      <h1 className="mb-5 text-2xl font-bold">Email</h1>

      <div className={`mb-6 rounded-lg p-4 text-sm shadow ${mailgunConfigured ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
        {mailgunConfigured ? (
          <>Mailgun is configured — queued emails send via <strong>{process.env.MAILGUN_DOMAIN}</strong>.</>
        ) : (
          <>Mailgun not configured yet. Emails queue safely in the outbox; add <code>MAILGUN_API_KEY</code> and <code>MAILGUN_DOMAIN</code> to <code>.env.local</code> to enable sending.</>
        )}
        {queuedCount > 0 && (
          <form action={sendQueuedEmails} className="mt-2">
            <button className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700">
              Send {queuedCount} Queued Email{queuedCount === 1 ? "" : "s"} Now
            </button>
          </form>
        )}
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-violet-700">Templates</h2>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-1 rounded-t-lg bg-zinc-800 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white">{g}</h3>
          <div className="overflow-hidden rounded-b-lg bg-white shadow">
            <ul className="divide-y divide-zinc-100">
              {(templates ?? []).filter((t) => t.group_name === g).map((t) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-3 italic text-zinc-400">Subject: {t.subject}</span>
                  </div>
                  <form action={deleteTemplate.bind(null, t.id)}>
                    <button className="text-xs font-semibold text-red-600 hover:underline">Delete</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      <h2 className="mt-6 mb-2 text-sm font-bold uppercase tracking-wide text-violet-700">Add Template</h2>
      <form action={createTemplate} className="space-y-4 rounded-lg bg-white p-5 shadow">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={label}>Group</label>
            <input name="group_name" defaultValue="GENERAL" className={input} list="groups" />
            <datalist id="groups">
              {["BOOKED", "BOOKING AGREEMENT", "LEADS", "EMPLOYEES", "GENERAL"].map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <div className="md:col-span-2">
            <label className={label}>Template Name</label>
            <input name="name" required className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Subject</label>
          <input name="subject" className={input} placeholder="Your <event_type> on <event_date_long>" />
        </div>
        <div>
          <label className={label}>Body (HTML, merge tags supported)</label>
          <textarea name="body_html" rows={8} className={`${input} font-mono text-xs`} placeholder="<p>Hi <first_name>,</p>" />
        </div>
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer font-semibold">Available merge tags</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MERGE_TAGS.map((t) => (
              <code key={t} className="rounded bg-zinc-100 px-1.5 py-0.5">{t}</code>
            ))}
          </div>
        </details>
        <button className="rounded-md bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
          Save Template
        </button>
      </form>

      <h2 className="mt-8 mb-2 text-sm font-bold uppercase tracking-wide text-violet-700">Send Log</h2>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Queued</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(log ?? []).map((m) => (
              <tr key={m.id} className="border-t border-zinc-100">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{m.to_address}</td>
                <td className="px-4 py-2">{m.subject}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      m.status === "sent" || m.status === "delivered"
                        ? "bg-green-100 text-green-800"
                        : m.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                    title={m.error ?? undefined}
                  >
                    {m.status}
                  </span>
                </td>
              </tr>
            ))}
            {(log ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  No emails yet — run a booking helper that sends one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
