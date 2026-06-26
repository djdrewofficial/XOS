import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import { sendQueuedEmails, saveCompanySettings, sendTest, runScheduledNow } from "./actions";
import { createBlankTemplate, deleteTemplate, duplicateTemplate } from "./templates/actions";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: log }, { data: company }] = await Promise.all([
    supabase.from("email_templates").select("*").eq("is_active", true).order("group_name").order("name"),
    supabase.from("email_log").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("company_settings").select("*").eq("id", true).maybeSingle(),
  ]);

  const mailgunConfigured = !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
  const region = (process.env.MAILGUN_REGION ?? "us").toUpperCase();
  const queuedCount = (log ?? []).filter((m) => m.status === "queued").length;

  const groups = [...new Set((templates ?? []).map((t) => t.group_name))];

  const input =
    "input w-full";
  const label = "label-xs";

  return (
    <div className="max-w-[1700px]">
      <h1 className="mb-5 text-2xl font-bold">Email</h1>

      <div className={`card mb-6 p-4 text-sm ${mailgunConfigured ? "border-emerald-400/30 text-emerald-800 dark:text-emerald-200" : "border-amber-400/30 text-amber-800 dark:text-amber-200"}`}>
        {mailgunConfigured ? (
          <>Mailgun is configured — queued emails send via <strong>{process.env.MAILGUN_DOMAIN}</strong> ({region} region).</>
        ) : (
          <>Mailgun not configured yet. Emails queue safely in the outbox; add <code>MAILGUN_API_KEY</code> and <code>MAILGUN_DOMAIN</code> to <code>.env.local</code> to enable sending.</>
        )}
        {queuedCount > 0 && (
          <form action={sendQueuedEmails} className="mt-2">
            <SaveButton className="btn-primary px-4 py-1.5">
              Send {queuedCount} Queued Email{queuedCount === 1 ? "" : "s"} Now
            </SaveButton>
          </form>
        )}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="card-title">Company Sending Identity</h2>
          <form action={saveCompanySettings} className="card space-y-3 p-5">
            <p className="text-xs text-zinc-500">
              The default “from” for emails. Booking helpers can override this to send as the assigned salesperson or DJ —
              any address on your verified domain sends through Mailgun with no extra login.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={label}>Company Name</label>
                <input name="company_name" defaultValue={company?.company_name ?? "Xpress Entertainment"} className={input} />
              </div>
              <div>
                <label className={label}>From Name</label>
                <input name="from_name" defaultValue={company?.from_name ?? "Xpress Entertainment"} className={input} />
              </div>
              <div>
                <label className={label}>From Email</label>
                <input name="from_email" type="email" defaultValue={company?.from_email ?? "events@xpressdjs.com"} className={input} />
              </div>
              <div>
                <label className={label}>Reply-To (optional)</label>
                <input name="reply_to" type="email" defaultValue={company?.reply_to ?? ""} placeholder="(defaults to From)" className={input} />
              </div>
            </div>
            <SaveButton>Save Identity</SaveButton>
          </form>
        </div>

        <div>
          <h2 className="card-title">Send a Test Email</h2>
          <form action={sendTest} className="card space-y-3 p-5">
            <p className="text-xs text-zinc-500">
              Sends a test message from your company identity through Mailgun, then records it in the log below — the
              fastest way to confirm sending works end to end.
            </p>
            <div>
              <label className={label}>To Address</label>
              <input name="test_to" type="email" required placeholder="you@example.com" className={input} />
            </div>
            <SaveButton disabled={!mailgunConfigured}>
              {mailgunConfigured ? "Send Test" : "Configure Mailgun first"}
            </SaveButton>
          </form>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title mb-0">Templates</h2>
        <div className="flex gap-2">
          <form action={runScheduledNow}>
            <button className="btn-ghost text-xs" title="Check scheduled templates and queue any that are due right now">
              Run Scheduled Now
            </button>
          </form>
          <form action={createBlankTemplate}>
            <SaveButton className="btn-primary text-sm" savedLabel="Added">+ Add Template</SaveButton>
          </form>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-1 rounded-t-xl bg-black/[0.07] dark:bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-900 dark:text-white">{g}</h3>
          <div className="card overflow-hidden rounded-t-none">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {(templates ?? []).filter((t) => t.group_name === g).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/settings/email/templates/${t.id}`} className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-800 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-lighter">
                      {t.display_name ?? t.name}
                    </span>
                    {t.schedule_enabled && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                        Scheduled {t.schedule_days}d {t.schedule_direction}
                      </span>
                    )}
                    <span className="ml-3 truncate italic text-zinc-500">{t.subject}</span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <Link href={`/settings/email/templates/${t.id}`} className="text-xs font-semibold text-brand dark:text-brand-lighter hover:underline">Edit</Link>
                    <form action={duplicateTemplate.bind(null, t.id)}>
                      <button className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:underline">Duplicate</button>
                    </form>
                    <form action={deleteTemplate.bind(null, t.id)}>
                      <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Delete</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      <h2 className="card-title mt-8">Send Log</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Queued</th>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(log ?? []).map((m) => (
              <tr key={m.id} className="row">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 whitespace-nowrap text-xs text-zinc-500" title={m.from_address ?? undefined}>
                  {m.from_name ?? m.from_address ?? "—"}
                </td>
                <td className="px-4 py-2">{m.to_address}</td>
                <td className="px-4 py-2">{m.subject}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      m.status === "delivered" || m.status === "opened"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : m.status === "sent"
                        ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                        : m.status === "failed" || m.status === "bounced" || m.status === "complained"
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
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-400">
                  No emails yet — run a booking helper that sends one, or send a test above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
