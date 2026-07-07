import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SaveButton from "@/components/SaveButton";
import { sendQueuedEmails, saveCompanySettings, saveEmailSignature, sendTest, runScheduledNow, saveSendingLimits, addBlackoutDate, removeBlackoutDate } from "./actions";
import { createBlankTemplate, deleteTemplate, duplicateTemplate } from "./templates/actions";
import { templateReviewReasons } from "@/lib/emailTemplateReview";
import Tabs from "@/components/Tabs";
import SignatureBuilder from "@/components/SignatureBuilder";

export const dynamic = "force-dynamic";

type Tpl = {
  id: string;
  group_name: string;
  name: string;
  display_name: string | null;
  subject: string | null;
  schedule_enabled: boolean;
  schedule_days: number | null;
  schedule_direction: string | null;
  is_sms: boolean | null;
  review_reasons: string[] | null;
  djep_was_enabled: boolean | null;
};

function ReviewBadge({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <span
      title={reasons.join("\n")}
      className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400"
    >
      ⚠ Needs Review
    </span>
  );
}

function TemplateGroups({ templates }: { templates: Tpl[] }) {
  const groups = [...new Set(templates.map((t) => t.group_name))];
  return (
    <>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-1 rounded-t-xl bg-black/[0.07] dark:bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-900 dark:text-white">{g}</h3>
          <div className="card overflow-hidden rounded-t-none">
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {templates.filter((t) => t.group_name === g).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/settings/email/templates/${t.id}`} className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-800 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-lighter">
                      {t.display_name ?? t.name}
                    </span>
                    <ReviewBadge reasons={templateReviewReasons(t)} />
                    {t.schedule_enabled && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                        Scheduled {t.schedule_days}d {t.schedule_direction}
                      </span>
                    )}
                    {t.djep_was_enabled && !t.schedule_enabled && (
                      <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700 dark:text-sky-400" title="This automation was turned on in DJEP">
                        Was On In DJEP
                      </span>
                    )}
                    {!t.is_sms && <span className="ml-3 truncate italic text-zinc-500">{t.subject}</span>}
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
    </>
  );
}

export default async function EmailPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: log }, { data: company }, { data: blackouts }] = await Promise.all([
    supabase.from("email_templates").select("*").eq("is_active", true).order("group_name").order("name"),
    supabase.from("email_log").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("company_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("email_blackout_dates").select("*").order("day"),
  ]);

  const mailgunConfigured = !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
  const region = (process.env.MAILGUN_REGION ?? "us").toUpperCase();
  const queuedCount = (log ?? []).filter((m) => m.status === "queued").length;

  const allTemplates = (templates ?? []) as Tpl[];
  const emailTemplates = allTemplates.filter((t) => !t.is_sms);
  const smsTemplates = allTemplates.filter((t) => t.is_sms);
  const reviewCount = allTemplates.filter((t) => templateReviewReasons(t).length > 0).length;

  const input =
    "input w-full";
  const label = "label-xs";

  const templatesTab = (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title mb-0">
          Email Templates
          {reviewCount > 0 && (
            <span className="ml-2 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold uppercase text-amber-700 dark:text-amber-400">
              {reviewCount} need review
            </span>
          )}
        </h2>
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
      <TemplateGroups templates={emailTemplates} />
    </div>
  );

  const smsTab = (
    <div>
      <div className="card mb-3 border-sky-400/30 p-3 text-xs text-sky-800 dark:text-sky-200">
        Imported from DJEP. XOS does not send text messages yet — these are kept here so the copy and timing are ready when SMS sending is added.
      </div>
      <TemplateGroups templates={smsTemplates} />
    </div>
  );

  const settingsTab = (
    <div className="space-y-6">
      <div className={`card p-4 text-sm ${mailgunConfigured ? "border-emerald-400/30 text-emerald-800 dark:text-emerald-200" : "border-amber-400/30 text-amber-800 dark:text-amber-200"}`}>
        {mailgunConfigured ? (
          <>Mailgun is configured — queued emails send via <strong>{process.env.MAILGUN_DOMAIN}</strong> ({region} region).</>
        ) : (
          <>Mailgun not configured yet. Emails queue safely in the outbox; add <code>MAILGUN_API_KEY</code> and <code>MAILGUN_DOMAIN</code> to <code>.env.local</code> to enable sending.</>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
              Sends a test message from your company identity through Mailgun, then records it in the log — the
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

      <div>
        <h2 className="card-title">Email Signature</h2>
        <form action={saveEmailSignature} className="card space-y-3 p-5">
          <p className="text-xs text-zinc-500">
            Your branded email sign-off. Toggle what to include and it appears anywhere a template body has the{" "}
            <code>&lt;company_email_signature&gt;</code> merge tag — drop that tag in wherever you want the signature.
            The logo switches to its white version in dark-mode inboxes so it never disappears.
          </p>
          <SignatureBuilder initial={company?.email_signature_config ?? undefined} />
          <SaveButton>Save Signature</SaveButton>
        </form>
      </div>

      <div>
        <h2 className="card-title">Sending Limits</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={saveSendingLimits} className="card space-y-3 p-5">
            <p className="text-xs text-zinc-500">
              Quiet hours for scheduled client emails. The scheduler only queues messages when the current time (company
              timezone) is inside this window. Leave both blank for no limit.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Send No Earlier Than</label>
                <input name="email_send_window_start" type="time" defaultValue={(company?.email_send_window_start ?? "").slice(0, 5)} className={input} />
              </div>
              <div>
                <label className={label}>Send No Later Than</label>
                <input name="email_send_window_end" type="time" defaultValue={(company?.email_send_window_end ?? "").slice(0, 5)} className={input} />
              </div>
            </div>
            <SaveButton>Save Limits</SaveButton>
          </form>

          <div className="card space-y-3 p-5">
            <p className="text-xs text-zinc-500">
              Holiday blackout dates. Scheduled emails never send on these days (e.g. Christmas, Thanksgiving).
            </p>
            <form action={addBlackoutDate} className="flex flex-wrap items-end gap-2">
              <div>
                <label className={label}>Date</label>
                <input name="day" type="date" required className="input" />
              </div>
              <div className="flex-1">
                <label className={label}>Label (optional)</label>
                <input name="label" placeholder="e.g. Christmas" className="input w-full" />
              </div>
              <SaveButton className="btn-primary text-sm" savedLabel="Added">+ Add</SaveButton>
            </form>
            <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
              {(blackouts ?? []).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {new Date(`${b.day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                    </span>
                    {b.label && <span className="ml-2 text-zinc-500">{b.label}</span>}
                  </span>
                  <form action={removeBlackoutDate.bind(null, b.id)}>
                    <button className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
              {(blackouts ?? []).length === 0 && (
                <li className="py-3 text-center text-xs text-zinc-500">No blackout dates yet.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  const logTab = (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="card-title mb-0">Send Log</h2>
        {queuedCount > 0 && (
          <form action={sendQueuedEmails}>
            <SaveButton className="btn-primary px-4 py-1.5 text-sm">
              Send {queuedCount} Queued Email{queuedCount === 1 ? "" : "s"} Now
            </SaveButton>
          </form>
        )}
      </div>
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
                  No emails yet — run a booking helper that sends one, or send a test.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="max-w-[1700px]">
      <h1 className="mb-5 text-2xl font-bold">Email</h1>
      <Tabs
        tabs={[
          { id: "templates", label: "Email Templates", badge: reviewCount || undefined, content: templatesTab },
          { id: "sms", label: "SMS Templates", badge: smsTemplates.length || undefined, content: smsTab },
          { id: "settings", label: "Sending Settings", content: settingsTab },
          { id: "log", label: "Send Log", badge: queuedCount || undefined, content: logTab },
        ]}
      />
    </div>
  );
}
