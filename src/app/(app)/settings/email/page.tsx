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
    "input w-full";
  const label = "label-xs";

  return (
    <div className="max-w-5xl">
      <h1 className="mb-5 text-2xl font-bold">Email</h1>

      <div className={`card mb-6 p-4 text-sm ${mailgunConfigured ? "border-emerald-400/30 text-emerald-200" : "border-amber-400/30 text-amber-800 dark:text-amber-200"}`}>
        {mailgunConfigured ? (
          <>Mailgun is configured — queued emails send via <strong>{process.env.MAILGUN_DOMAIN}</strong>.</>
        ) : (
          <>Mailgun not configured yet. Emails queue safely in the outbox; add <code>MAILGUN_API_KEY</code> and <code>MAILGUN_DOMAIN</code> to <code>.env.local</code> to enable sending.</>
        )}
        {queuedCount > 0 && (
          <form action={sendQueuedEmails} className="mt-2">
            <button className="btn-primary px-4 py-1.5">
              Send {queuedCount} Queued Email{queuedCount === 1 ? "" : "s"} Now
            </button>
          </form>
        )}
      </div>

      <h2 className="card-title">Templates</h2>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-1 rounded-t-xl bg-black/[0.07] dark:bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-900 dark:text-white">{g}</h3>
          <div className="card overflow-hidden rounded-t-none">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {(templates ?? []).filter((t) => t.group_name === g).map((t) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-3 italic text-zinc-600 dark:text-zinc-400">Subject: {t.subject}</span>
                  </div>
                  <form action={deleteTemplate.bind(null, t.id)}>
                    <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Delete</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      <h2 className="card-title mt-6">Add Template</h2>
      <form action={createTemplate} className="space-y-4 card p-5">
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
              <code key={t} className="rounded bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5">{t}</code>
            ))}
          </div>
        </details>
        <button className="btn-primary">
          Save Template
        </button>
      </form>

      <h2 className="card-title mt-8">Send Log</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Queued</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(log ?? []).map((m) => (
              <tr key={m.id} className="row">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{m.to_address}</td>
                <td className="px-4 py-2">{m.subject}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      m.status === "sent" || m.status === "delivered"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : m.status === "failed"
                        ? "bg-red-500/15 text-red-700 dark:text-red-300"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
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
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-400">
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
