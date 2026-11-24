"use client";

import { useState, useTransition } from "react";
import { previewTemplateAction } from "@/app/(app)/settings/app-notifications/actions";

type EventOpt = { id: string; name: string; event_date: string | null };

export default function AppNotifPreview({ templateId, events }: { templateId: string; events: EventOpt[] }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    title: string;
    body: string;
    dj: { name: string; bookingUrl: string };
    gate: { ok: true } | { ok: false; reason: string };
    recipients: { authUserId: string; role: string }[];
    screen: { heading: string; body_html: string; embed_html: string | null } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (!eventId) return;
    setError(null);
    start(async () => {
      try {
        const r = await previewTemplateAction(templateId, eventId);
        setResult({
          title: r.title,
          body: r.body,
          dj: { name: r.dj.name, bookingUrl: r.dj.bookingUrl },
          gate: r.gate,
          recipients: r.recipients,
          screen: r.screen
            ? { heading: r.screen.heading, body_html: r.screen.body_html, embed_html: r.screen.embed_html }
            : null,
        });
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[16rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Sample event</span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="input w-full">
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.event_date ? ` · ${e.event_date}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={run} disabled={pending || !eventId} className="btn-primary px-5">
          {pending ? "Previewing…" : "Preview"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-white/[0.06]">
            <div className="font-semibold">{result.title}</div>
            <div className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{result.body}</div>
          </div>
          <p className="text-xs text-zinc-500">
            DJ: {result.dj.name}
            {result.dj.bookingUrl ? ` · ${result.dj.bookingUrl}` : ""}
            {" · "}
            {result.recipients.length} recipient{result.recipients.length === 1 ? "" : "s"}
            {" · "}
            gate: {result.gate.ok ? "would send" : `skip (${result.gate.reason})`}
          </p>
          {result.screen && (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <div className="text-xs font-semibold uppercase text-zinc-500">Custom screen</div>
              <div className="mt-1 font-medium">{result.screen.heading}</div>
              <div
                className="prose prose-sm mt-2 max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: result.screen.body_html }}
              />
              {result.screen.embed_html ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Embed HTML present ({result.screen.embed_html.length} chars) — not rendered here. The couple app loads
                  it in a sandboxed WebView.
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
