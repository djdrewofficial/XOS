import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { REASON_LABELS, type ReportReason } from "@/lib/ugcModeration";
import { loadStaffModeration } from "@/lib/ugcModerationServer";
import { restoreHiddenContent, setContentReportStatus } from "@/app/(app)/events/[id]/moderation-actions";
import SaveButton from "@/components/SaveButton";

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** Staff list of member reports and soft-hidden event content. Reported and
    removed rows stay visible here. */
export default async function EventModerationPanel({ eventId }: { eventId: string }) {
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff") return null;
  const data = await loadStaffModeration(supabase, eventId);

  if (data.setup) {
    return (
      <div className="card p-5">
        <h2 className="card-title">Content reports</h2>
        <p className="mt-2 text-sm text-zinc-500">
          One-time setup needed. Apply migration 00216_event_ugc_moderation.sql before reports and removed content show up here.
        </p>
      </div>
    );
  }

  const open = data.reports.filter((report) => report.status === "open");

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="card-title">Content reports</h2>
          {open.length > 0 && (
            <span className="chip bg-amber-500/15 text-amber-800 dark:text-amber-200">{open.length} open</span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Couples and guests can report a song, note, answer, like, or person. Reported content stays visible here so you can review it.
        </p>
        {data.reports.length === 0 && <p className="mt-3 text-sm text-zinc-500">No reports on this event.</p>}
        <ul className="mt-3 space-y-3">
          {data.reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{report.targetLabel}</span>
                <span className="chip bg-zinc-500/10 text-zinc-600 dark:text-zinc-300">
                  {REASON_LABELS[report.reason as ReportReason] ?? report.reason}
                </span>
                <span className="text-xs uppercase tracking-wide text-zinc-400">{report.status}</span>
                <span className="text-xs text-zinc-400">{when(report.createdAt)} UTC</span>
              </div>
              {report.details && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{report.details}</p>}
              {report.status === "open" && (
                <div className="mt-2 flex gap-2">
                  <form action={setContentReportStatus}>
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="status" value="resolved" />
                    <SaveButton className="btn-primary px-3 py-1.5 text-xs" savedLabel="Resolved">
                      Resolve
                    </SaveButton>
                  </form>
                  <form action={setContentReportStatus}>
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="status" value="dismissed" />
                    <SaveButton className="btn-ghost px-3 py-1.5 text-xs" savedLabel="Dismissed">
                      Dismiss
                    </SaveButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5">
        <h2 className="card-title">Removed content</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Hidden from the couple and guests. The row is kept so the DJ can still see what was removed.
        </p>
        {data.hidden.length === 0 && <p className="mt-3 text-sm text-zinc-500">Nothing has been removed.</p>}
        <ul className="mt-3 space-y-3">
          {data.hidden.map((item) => (
            <li key={`${item.targetType}-${item.targetId}-${item.targetUserId ?? ""}`} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip bg-rose-500/15 text-rose-700 dark:text-rose-300">Removed</span>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{item.label}</span>
                <span className="text-xs text-zinc-400">{when(item.hiddenAt)} UTC</span>
              </div>
              <form action={restoreHiddenContent} className="mt-2">
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="targetType" value={item.targetType} />
                <input type="hidden" name="targetId" value={item.targetId} />
                <input type="hidden" name="targetUserId" value={item.targetUserId ?? ""} />
                <SaveButton className="btn-ghost px-3 py-1.5 text-xs" savedLabel="Restored">
                  Restore
                </SaveButton>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
