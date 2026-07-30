"use client";

import { useMemo, useState } from "react";
import {
  resolvePlannerTracksForExport,
  createSpotifyPlaylistsFromConfirmed,
  type ResolvedSection,
  type SpotifyExportResult,
} from "@/app/(app)/events/[id]/spotify-export-actions";

/* Staff-only Spotify export. Flow: pick sections → resolve matches (YouTube
   titles cleaned by AI) → DJ confirms each match → create playlists.
   variant "button" = inline text button; "fab" = floating Spotify-logo button
   (used inside the planner). */

type Section = { id: string; title: string; songCount: number };

const SPOTIFY_GREEN = "#1DB954";

function SpotifyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export default function SpotifyExport({
  eventId,
  connected,
  canWrite,
  displayName,
  sections,
  variant = "button",
}: {
  eventId: string;
  connected: boolean;
  canWrite: boolean;
  displayName: string | null;
  sections: Section[];
  variant?: "button" | "fab";
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"select" | "review" | "results">("select");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<ResolvedSection[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [results, setResults] = useState<SpotifyExportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withSongs = sections.filter((s) => s.songCount > 0);
  const connectUrl = `/api/spotify/connect?eventId=${eventId}&returnTo=${encodeURIComponent(`/events/${eventId}`)}`;

  const selectedCount = useMemo(() => {
    if (!resolved) return 0;
    let n = 0;
    for (const sec of resolved) for (const s of sec.songs) if (s.candidate && !excluded.has(s.songId)) n++;
    return n;
  }, [resolved, excluded]);

  const reset = () => {
    setPhase("select");
    setSelected(new Set());
    setResolved(null);
    setExcluded(new Set());
    setResults(null);
    setError(null);
    setTruncated(false);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const toggleSection = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSong = (songId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await resolvePlannerTracksForExport(eventId, [...selected]);
      if (out.error) setError(out.error);
      else if (out.needsConnect) setError("Connect your Spotify first.");
      else if (out.needsReconnect) setError("Reconnect Spotify to grant playlist-create permission.");
      else {
        setResolved(out.sections ?? []);
        setTruncated(!!out.truncated);
        setExcluded(new Set()); // default: every matched song included
        setPhase("review");
      }
    } catch {
      setError("Something went wrong resolving tracks. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!resolved) return;
    setBusy(true);
    setError(null);
    try {
      const picks = resolved.map((sec) => ({
        sectionId: sec.sectionId,
        trackIds: sec.songs.filter((s) => s.candidate && !excluded.has(s.songId)).map((s) => s.candidate!.trackId),
      }));
      const out = await createSpotifyPlaylistsFromConfirmed(eventId, picks);
      if (out.error) setError(out.error);
      else if (out.needsConnect) setError("Connect your Spotify first.");
      else if (out.needsReconnect) setError("Reconnect Spotify to grant permission.");
      else {
        setResults(out.results ?? []);
        setPhase("results");
      }
    } catch {
      setError("Something went wrong creating playlists. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === "fab" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Export to Spotify"
          aria-label="Export to Spotify"
          style={{ color: SPOTIFY_GREEN }}
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 transition hover:scale-105 dark:bg-zinc-100"
        >
          <SpotifyGlyph className="h-9 w-9" />
          <span className="sr-only">Export to Spotify</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost inline-flex items-center gap-1.5 px-4 py-2 text-sm">
          <span style={{ color: SPOTIFY_GREEN }}><SpotifyGlyph className="h-4 w-4" /></span>
          Export to Spotify
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={close}>
          <div
            className="my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-white/10">
              <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-zinc-50">
                <span style={{ color: SPOTIFY_GREEN }}><SpotifyGlyph className="h-5 w-5" /></span>
                Export to Spotify
              </h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {!connected ? (
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-600 dark:text-zinc-300">Connect your Spotify account to export playlists into it.</p>
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    ⚠️ Management must activate your account on the backend first. Ask them to add your Spotify email to the Xpress
                    developer dashboard before connecting — otherwise Spotify will reject the login.
                  </div>
                  <a href={connectUrl} className="btn-primary inline-block">Connect Spotify</a>
                </div>
              ) : !canWrite ? (
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-600 dark:text-zinc-300">
                    Your Spotify{displayName ? ` (${displayName})` : ""} is connected, but was linked before playlist-creation was
                    enabled. Reconnect once to grant permission.
                  </p>
                  <a href={connectUrl} className="btn-primary inline-block">Reconnect Spotify</a>
                </div>
              ) : phase === "results" && results ? (
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <div key={i} className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm dark:border-white/10">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-50">{r.section}</div>
                      {r.error ? (
                        <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{r.error}</div>
                      ) : (
                        <>
                          <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">{r.added} songs added</div>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand underline dark:text-brand-lighter">
                              Open playlist in Spotify ↗
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <button onClick={close} className="btn-primary w-full">Done</button>
                </div>
              ) : phase === "review" && resolved ? (
                <>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Confirm the matches below, then create the playlists. Uncheck anything that looks wrong — YouTube songs
                    especially, since their titles can be off.
                  </p>
                  {truncated && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      Long list — only the first 400 songs were resolved.
                    </div>
                  )}
                  {resolved.map((sec) => (
                    <div key={sec.sectionId} className="space-y-1.5">
                      <div className="text-xs font-bold uppercase tracking-wide text-zinc-400">{sec.title}</div>
                      {sec.songs.map((s) => {
                        const on = !!s.candidate && !excluded.has(s.songId);
                        const isYt = s.provider === "youtube";
                        return (
                          <div
                            key={s.songId}
                            className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                              !s.candidate ? "border-red-200 bg-red-50/50 dark:border-red-500/20 dark:bg-red-500/5" : on ? "border-zinc-200 dark:border-white/10" : "border-zinc-200 opacity-50 dark:border-white/10"
                            }`}
                          >
                            <button
                              type="button"
                              disabled={!s.candidate}
                              onClick={() => toggleSong(s.songId)}
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-zinc-300 dark:border-white/20"} disabled:opacity-30`}
                            >
                              {on && <span className="text-[11px] leading-none">✓</span>}
                            </button>
                            {s.candidate?.artworkUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.candidate.artworkUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                            ) : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-300 dark:bg-white/5">♪</div>
                            )}
                            <div className="min-w-0 flex-1">
                              {s.candidate ? (
                                <>
                                  <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{s.candidate.title}</div>
                                  <div className="truncate text-xs text-zinc-500">{s.candidate.artist}</div>
                                </>
                              ) : (
                                <div className="text-sm font-medium text-red-600 dark:text-red-400">No Spotify match — {s.originalTitle}</div>
                              )}
                              {isYt && (
                                <div className="mt-0.5 truncate text-[10px] text-amber-600 dark:text-amber-400">
                                  from YouTube: {s.originalTitle}
                                  {s.originalArtist ? ` · ${s.originalArtist}` : ""} — please confirm
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPhase("select")} disabled={busy} className="btn-ghost px-3 py-2 text-sm">← Back</button>
                    <button onClick={create} disabled={busy || selectedCount === 0} className="btn-primary flex-1 disabled:opacity-50">
                      {busy ? "Creating…" : `Create ${selectedCount} track${selectedCount === 1 ? "" : "s"} → playlists`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Choose which sections to export{displayName ? ` to ${displayName}` : ""}. Each becomes its own playlist named{" "}
                    <span className="font-mono text-xs">MM/DD - Event - Section</span>. You&apos;ll confirm the matches next.
                  </p>
                  {withSongs.length === 0 ? (
                    <p className="rounded-lg border border-zinc-200 px-3 py-3 text-center text-sm text-zinc-400 dark:border-white/10">No planner sections with songs yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {withSongs.map((s) => {
                        const on = selected.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSection(s.id)}
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
                  <button onClick={resolve} disabled={busy || selected.size === 0} className="btn-primary w-full disabled:opacity-50">
                    {busy ? "Matching songs…" : "Review matches →"}
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
