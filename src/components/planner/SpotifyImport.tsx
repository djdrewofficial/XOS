"use client";

import { useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpotify } from "@fortawesome/free-brands-svg-icons";
import { faXmark, faCheck, faSpinner, faArrowRightToBracket } from "@fortawesome/free-solid-svg-icons";
import {
  spotifyStatus,
  spotifyPlaylists,
  importSpotifyPlaylist,
  disconnectSpotifyAccount,
} from "@/app/portal/plan/[eventId]/actions";

type Playlist = { id: string; name: string; image: string | null; trackCount: number; owner: string | null };

export default function SpotifyImport({ eventId, sectionId }: { eventId: string; sectionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [, start] = useTransition();

  async function openPanel() {
    setOpen(true);
    setLoading(true);
    const s = await spotifyStatus(eventId);
    setConnected(s.connected);
    setDisplayName(s.displayName);
    if (s.connected) setPlaylists(await spotifyPlaylists(eventId));
    setLoading(false);
  }

  function doImport(p: Playlist) {
    setMsg(null);
    setImportingId(p.id);
    start(async () => {
      const res = await importSpotifyPlaylist(eventId, sectionId, p.id);
      setImportingId(null);
      setMsg(res?.ok ? `Added ${res.count} songs from “${p.name}”` : res?.error || "Import failed");
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
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          <FontAwesomeIcon icon={faSpotify} className="text-[#1DB954]" /> Import from Spotify
        </span>
        <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
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

      {!loading && connected && (
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
                <li key={p.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-50 dark:hover:bg-white/5">
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
                  <button
                    onClick={() => doImport(p)}
                    disabled={importingId !== null}
                    className="rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                  >
                    {importingId === p.id ? <FontAwesomeIcon icon={faSpinner} className="animate-spin" /> : <><FontAwesomeIcon icon={faArrowRightToBracket} className="mr-1" />Import</>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {msg && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>}
    </div>
  );
}
