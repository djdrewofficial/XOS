"use client";

import { useState } from "react";
import { exportSectionsToSpotify, type SpotifyExportResult } from "@/app/(app)/events/[id]/spotify-export-actions";

/* Staff-only: export planner sections to the signed-in staffer's Spotify.
   One playlist per selected section, named "MM/DD - EVENT - SECTION". */

type Section = { id: string; title: string; songCount: number };

export default function SpotifyExport({
  eventId,
  connected,
  canWrite,
  displayName,
  sections,
}: {
  eventId: string;
  connected: boolean;
  canWrite: boolean;
  displayName: string | null;
  sections: Section[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SpotifyExportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withSongs = sections.filter((s) => s.songCount > 0);
  const connectUrl = `/api/spotify/connect?eventId=${eventId}&returnTo=${encodeURIComponent(`/events/${eventId}`)}`;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const out = await exportSectionsToSpotify(eventId, [...selected]);
      if (out.error) setError(out.error);
      else if (out.needsConnect) setError("Connect your Spotify first.");
      else if (out.needsReconnect) setError("Reconnect Spotify to grant playlist-create permission.");
      else setResults(out.results ?? []);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const close = () => {
    setOpen(false);
    setResults(null);
    setError(null);
    setSelected(new Set());
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost px-4 py-2 text-sm">
        Export to Spotify
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={close}>
          <div
            className="my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-white/10">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Export to Spotify</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {!connected ? (
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-600 dark:text-zinc-300">
                    Connect your Spotify account to export playlists into it.
                  </p>
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    ⚠️ Management must activate your account on the backend first. Ask them to add your Spotify email to the
                    Xpress developer dashboard before connecting — otherwise Spotify will reject the login.
                  </div>
                  <a href={connectUrl} className="btn-primary inline-block">Connect Spotify</a>
                </div>
              ) : !canWrite ? (
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-600 dark:text-zinc-300">
                    Your Spotify{displayName ? ` (${displayName})` : ""} is connected, but was linked before playlist-creation
                    was enabled. Reconnect once to grant permission to create playlists.
                  </p>
                  <a href={connectUrl} className="btn-primary inline-block">Reconnect Spotify</a>
                </div>
              ) : results ? (
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <div key={i} className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm dark:border-white/10">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-50">{r.section}</div>
                      {r.error ? (
                        <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{r.error}</div>
                      ) : (
                        <>
                          <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                            {r.added} of {r.total} songs added
                            {r.unmatched && r.unmatched.length > 0 ? ` · ${r.unmatched.length} not found` : ""}
                          </div>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand underline dark:text-brand-lighter">
                              Open playlist in Spotify ↗
                            </a>
                          )}
                          {r.unmatched && r.unmatched.length > 0 && (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-[11px] text-zinc-400">Couldn&apos;t match ({r.unmatched.length})</summary>
                              <ul className="mt-1 list-disc pl-4 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {r.unmatched.map((u, j) => <li key={j}>{u}</li>)}
                              </ul>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <button onClick={close} className="btn-primary w-full">Done</button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Choose which sections to export{displayName ? ` to ${displayName}` : ""}. Each becomes its own playlist named{" "}
                    <span className="font-mono text-xs">MM/DD - Event - Section</span>.
                  </p>
                  {withSongs.length === 0 ? (
                    <p className="rounded-lg border border-zinc-200 px-3 py-3 text-center text-sm text-zinc-400 dark:border-white/10">
                      No planner sections with songs yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {withSongs.map((s) => {
                        const on = selected.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggle(s.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${on ? "border-brand bg-brand/5" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"}`}
                          >
                            <span className="flex items-center gap-2.5">
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"}`}>
                                {on && <span className="text-[11px] leading-none">✓</span>}
                              </span>
                              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{s.title}</span>
                            </span>
                            <span className="shrink-0 text-xs text-zinc-400">{s.songCount} song{s.songCount === 1 ? "" : "s"}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

                  <button
                    onClick={run}
                    disabled={running || selected.size === 0}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {running ? "Exporting…" : `Export ${selected.size || ""} to Spotify`.trim()}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
