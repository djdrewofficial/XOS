import Link from "next/link";

type LogRow = {
  id: string;
  title: string;
  status: string;
  audience_role: string;
  queued_at: string;
  sent_at: string | null;
  template_id: string | null;
};

type RunRow = {
  id: string;
  template_id: string;
  trigger_key: string;
  status: string;
  created_at: string;
  app_notification_templates?: { name: string } | { name: string }[] | null;
};

function tplName(r: RunRow): string {
  const t = r.app_notification_templates;
  if (!t) return r.template_id.slice(0, 8);
  const row = Array.isArray(t) ? t[0] : t;
  return row?.name ?? r.template_id.slice(0, 8);
}

export default function EventAppNotifications({
  runs,
  log,
}: {
  runs: RunRow[];
  log: LogRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Couple app notifications</h3>
        <Link href="/settings/app-notifications" className="text-xs font-semibold text-brand hover:underline">
          Manage templates
        </Link>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Scheduled / triggered</h4>
        {runs.length === 0 ? (
          <p className="text-sm text-zinc-500">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-white/10 dark:border-white/10">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {tplName(r)}
                  <span className="text-zinc-400"> · {r.trigger_key}</span>
                </span>
                <span className="text-xs font-medium text-zinc-500">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sent / queued</h4>
        {log.length === 0 ? (
          <p className="text-sm text-zinc-500">No messages logged for this event.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-white/10 dark:border-white/10">
            {log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {r.title}
                  <span className="text-zinc-400">
                    {" "}
                    · {r.audience_role} · {(r.sent_at ?? r.queued_at).slice(0, 16).replace("T", " ")}
                  </span>
                </span>
                <span className="text-xs font-medium text-zinc-500">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
