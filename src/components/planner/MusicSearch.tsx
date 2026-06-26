"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { PreviewButton } from "@/components/planner/previewPlayer";

type Provider = "spotify" | "apple" | "youtube";

type Track = {
  provider: Provider;
  providerId: string;
  isrc?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  durationMs?: number | null;
  previewUrl?: string | null;
  externalUrl?: string | null;
};

type ProviderStatus = "ok" | "unconfigured" | "error";

type AddSong = (
  eventId: string,
  song: {
    sectionId: string;
    provider: Provider | "manual";
    providerId?: string | null;
    isrc?: string | null;
    title: string;
    artist?: string | null;
    album?: string | null;
    artworkUrl?: string | null;
    durationMs?: number | null;
    previewUrl?: string | null;
    externalUrl?: string | null;
  },
) => Promise<void>;

const PROVIDER_META: Record<Provider, { label: string; dot: string }> = {
  spotify: { label: "Spotify", dot: "bg-green-500" },
  apple: { label: "Apple Music", dot: "bg-pink-500" },
  youtube: { label: "YouTube", dot: "bg-red-500" },
};
// YouTube is excluded from open search (only resolvable via a pasted link), so
// it isn't a toggleable search provider — but its meta stays for link results.
const SEARCHABLE: Provider[] = ["spotify", "apple"];

export default function MusicSearch({
  eventId,
  sectionId,
  onAdd,
}: {
  eventId: string;
  sectionId: string;
  onAdd: AddSong;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["spotify", "apple"]);
  const [results, setResults] = useState<Track[]>([]);
  const [status, setStatus] = useState<Partial<Record<Provider, ProviderStatus>>>({});
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setStatus({});
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/music/search?q=${encodeURIComponent(term)}&providers=${providers.join(",")}`,
        );
        const json = await res.json();
        if (id !== reqId.current) return; // a newer query superseded this one
        setResults(json.results ?? []);
        setStatus(json.providers ?? {});
      } catch {
        if (id === reqId.current) setResults([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, providers, open]);

  function toggleProvider(p: Provider) {
    setProviders((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function add(track: Track) {
    start(() =>
      onAdd(eventId, {
        sectionId,
        provider: track.provider,
        providerId: track.providerId,
        isrc: track.isrc,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artworkUrl,
        durationMs: track.durationMs,
        previewUrl: track.previewUrl,
        externalUrl: track.externalUrl,
      }),
    );
  }

  function addManual() {
    const term = q.trim();
    if (!term) return;
    // Split "Title - Artist" if the user typed it that way.
    const [title, artist] = term.includes(" - ") ? term.split(" - ", 2) : [term, ""];
    start(() => onAdd(eventId, { sectionId, provider: "manual", title: title.trim(), artist: artist.trim() }));
    setQ("");
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <FontAwesomeIcon icon={faPlus} className="mr-2" /> Add songs
      </button>
    );
  }

  const anyConfigured = Object.values(status).some((s) => s === "ok");
  const unconfigured = (Object.keys(status) as Provider[]).filter((p) => status[p] === "unconfigured");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            autoFocus
            className="input w-full pl-9"
            placeholder="Search songs — or paste a YouTube link…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length === 0) addManual();
            }}
          />
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600" title="Close">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* Provider toggles */}
      <div className="mb-3 flex flex-wrap gap-2">
        {SEARCHABLE.map((p) => {
          const on = providers.includes(p);
          return (
            <button
              key={p}
              onClick={() => toggleProvider(p)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-brand bg-brand/5 text-brand dark:border-brand-light/60 dark:text-brand-lighter"
                  : "border-zinc-200 text-zinc-400 dark:border-white/10"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${PROVIDER_META[p].dot} ${on ? "" : "opacity-30"}`} />
              {PROVIDER_META[p].label}
            </button>
          );
        })}
      </div>

      {unconfigured.length > 0 && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          {unconfigured.map((p) => PROVIDER_META[p].label).join(", ")} not connected yet — add API keys to
          enable. You can still add songs manually.
        </p>
      )}

      {/* Results */}
      {loading && <p className="py-2 text-sm text-zinc-400">Searching…</p>}

      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {results.map((t) => (
          <li
            key={`${t.provider}-${t.providerId}`}
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-50 dark:hover:bg-white/5"
          >
            {t.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.artworkUrl} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-100 text-zinc-400 dark:bg-white/5">
                🎵
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{t.title}</p>
              <p className="truncate text-xs text-zinc-500">
                {t.artist}
                {t.album ? ` · ${t.album}` : ""}
              </p>
            </div>
            <span className={`h-2 w-2 rounded-full ${PROVIDER_META[t.provider].dot}`} title={PROVIDER_META[t.provider].label} />
            <PreviewButton
              id={`result-${t.provider}-${t.providerId}`}
              title={t.title}
              artist={t.artist}
              previewUrl={t.previewUrl}
              size="sm"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition hover:border-brand hover:text-brand dark:border-white/10"
            />
            <button
              onClick={() => add(t)}
              disabled={pending}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              Add
            </button>
          </li>
        ))}
      </ul>

      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div className="py-3 text-center text-sm text-zinc-500">
          {anyConfigured ? "No results." : "No music services connected yet."}
          <button onClick={addManual} className="ml-2 font-semibold text-brand underline dark:text-brand-lighter">
            Add “{q.trim()}” manually
          </button>
        </div>
      )}
    </div>
  );
}
