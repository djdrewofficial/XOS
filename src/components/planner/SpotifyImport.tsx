"use client";

import { useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpotify } from "@fortawesome/free-brands-svg-icons";
import { faXmark, faCheck, faSpinner, faArrowLeft, faRotate } from "@fortawesome/free-solid-svg-icons";
import {
  spotifyStatus,
  spotifyPlaylists,
  spotifyPlaylistTracks,
  importSpotifyTracks,
  enablePlaylistSync,
  disconnectSpotifyAccount,
} from "@/app/portal/plan/[eventId]/actions";

type Playlist = { id: string; name: string; image: string | null; trackCount: number; owner: string | null };
type Track = Awaited<ReturnType<typeof spotifyPlaylistTracks>>[number];

export default function SpotifyImport({ eventId, sectionId }: { eventId: string; sectionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  // track-picker view
  const [active, setActive] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [liveSync, setLiveSync] = useState(false);
  const [busy, setBusy] = useState(false);

  async function openPanel() {
    setOpen(true);
    setLoading(true);
    const s = await spotifyStatus(eventId);
    setConnected(s.connected);
    setDisplayName(s.displayName);
    if (s.connected) setPlaylists(await spotifyPlaylists(eventId));
    setLoading(false);
  }

  async function openPlaylist(p: Playlist) {
    setActive(p);
    setTracks(null);
    setChecked(new Set());
    setLiveSync(false);
    setMsg(null);
    const t = await spotifyPlaylistTracks(eventId, p.id);
    setTracks(t);
    setChecked(new Set(t.map((x) => x.providerId))); // default: all selected
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!tracks) return;
    setChecked((prev) => (prev.size === tracks.length ? new Set() : new Set(tracks.map((t) => t.providerId))));
  }

  function back() {
    setActive(null);
    setTracks(null);
  }

  function confirm() {
    if (!active) return;
    setBusy(true);
    setMsg(null);
    start(async () => {
      if (liveSync) {
        const res = await enablePlaylistSync(eventId, sectionId, active.id, active.name);
        setBusy(false);
        if (res.ok) {
          setMsg(`Now live-syncing “${active.name}” (${res.added} song${res.added === 1 ? "" : "s"} added). It'll update hourly.`);
          back();
        } else setMsg(res.error || "Could not start sync");
      } else {
        const picked = (tracks ?? []).filter((t) => checked.has(t.providerId));
        const res = await importSpotifyTracks(eventId, sectionId, picked);
        setBusy(false);
        if (res.ok) {
          setMsg(`Added ${res.count} song${res.count === 1 ? "" : "s"} from “${active.name}”`);
          back();
        } else setMsg(res.error || "Import failed");
      }
    });
  }

  const connectHref = `/api/spotify/connect?eventId=${eventId}&section=${sectionId}`;

  if (!open) {
    return (
      <button
        onClick={openPanel}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-600 transition hover:border-[#1DB954] hover:text-[#1DB954] dark:border-white/10 dark:text-zinc-300"
      >
        <FontAwesomeIcon icon={faSpotify} className="text-[#1DB954]" /> Import a Spotify playlist
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {active && (
            <button onClick={back} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title="Back to playlists">
              <FontAwesomeIcon icon={faArrowLeft} />
            </button>
          )}
          <FontAwesomeIcon icon={faSpotify} className="text-[#1DB954]" /> {active ? active.name : "Import from Spotify"}
        </span>
        <button onClick={() => { setOpen(false); back(); }} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {loading && <p className="py-3 text-sm text-zinc-400"><FontAwesomeIcon icon={faSpinner} className="mr-2 animate-spin" />Checking your Spotify…</p>}

      {!loading && connected === false && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-5 text-center dark:border-white/10">
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">Connect your Spotify to pull in your playlists.</p>
          <a href={connectHref} className="inline-flex items-center gap-2 rounded-lg bg-[#1DB954] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
            <FontAwesomeIcon icon={faSpotify} /> Connect Spotify
          </a>
          <p className="mt-2 text-[11px] text-zinc-400">We only read your playlists — never post anything.</p>
        </div>
      )}

      {/* Playlist list */}
      {!loading && connected && !active && (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span><FontAwesomeIcon icon={faCheck} className="mr-1 text-[#1DB954]" />Connected{displayName ? ` as ${displayName}` : ""}</span>
            <button onClick={() => start(() => disconnectSpotifyAccount(eventId).then(() => { setConnected(false); setPlaylists([]); }))} className="hover:text-red-500">
              Disconnect
            </button>
          </div>
          {playlists.length === 0 ? (
            <p className="py-3 text-sm text-zinc-400">No playlists found on your account.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {playlists.map((p) => (
                <li key={p.id}>
                  <button onClick={() => openPlaylist(p)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-zinc-50 dark:hover:bg-white/5">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-100 text-zinc-400 dark:bg-white/5"><FontAwesomeIcon icon={faSpotify} /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{p.name}</p>
                      <p className="truncate text-xs text-zinc-500">{p.trackCount} songs{p.owner ? ` · ${p.owner}` : ""}</p>
                    </div>
                    <span className="text-zinc-300">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Track picker */}
      {!loading && connected && active && (
        <>
          {tracks === null ? (
            <p className="py-6 text-center text-sm text-zinc-400"><FontAwesomeIcon icon={faSpinner} className="mr-2 animate-spin" />Loading songs…</p>
          ) : (
            <>
              <label className="mb-2 flex cursor-pointer items-center gap-2 border-b border-zinc-100 pb-2 dark:border-white/10">
                <input type="checkbox" checked={tracks.length > 0 && checked.size === tracks.length} onChange={toggleAll} disabled={liveSync} className="h-4 w-4 accent-[#1DB954]" />
                <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  {liveSync ? "Entire playlist will be synced" : `${checked.size} song${checked.size === 1 ? "" : "s"} selected`}
                </span>
              </label>

              <ul className={`max-h-72 space-y-0.5 overflow-y-auto ${liveSync ? "pointer-events-none opacity-50" : ""}`}>
                {tracks.map((t, i) => {
                  const on = checked.has(t.providerId);
                  return (
                    <li key={`${t.providerId}-${i}`}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-1.5 hover:bg-zinc-50 dark:hover:bg-white/5">
                        <input type="checkbox" checked={on} onChange={() => toggle(t.providerId)} className="h-4 w-4 accent-[#1DB954]" />
                        {t.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.artworkUrl} alt="" className="h-9 w-9 rounded object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded bg-zinc-100 text-zinc-400 dark:bg-white/5">🎵</div>
                        )}
                        <span className="w-5 shrink-0 text-right text-xs text-zinc-400">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{t.title}</span>
                          <span className="block truncate text-xs text-zinc-500">{t.artist}</span>
                        </span>
                        <FontAwesomeIcon icon={faSpotify} className="text-[#1DB954]" />
                      </label>
                    </li>
                  );
                })}
              </ul>

              {/* Live-sync toggle */}
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-3 dark:border-white/10">
                <input type="checkbox" checked={liveSync} onChange={(e) => setLiveSync(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
                <span className="text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-100">
                    <FontAwesomeIcon icon={faRotate} className="text-brand dark:text-brand-lighter" /> Keep this playlist in sync
                  </span>
                  <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                    Songs you add or remove on Spotify update here automatically (about every hour). The whole playlist stays mirrored.
                  </span>
                </span>
              </label>

              <button
                onClick={confirm}
                disabled={busy || (!liveSync && checked.size === 0)}
                className="btn-primary mt-3 w-full py-2.5 disabled:opacity-50"
              >
                {busy ? (
                  <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
                ) : liveSync ? (
                  <><FontAwesomeIcon icon={faRotate} className="mr-2" />Start live sync</>
                ) : (
                  `Add ${checked.size} song${checked.size === 1 ? "" : "s"}`
                )}
              </button>
            </>
          )}
        </>
      )}

      {msg && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>}
    </div>
  );
}
