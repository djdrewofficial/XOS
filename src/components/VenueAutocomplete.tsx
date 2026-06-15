"use client";

import { useEffect, useRef, useState } from "react";

/* Client-facing venue picker backed by Google Places (via /api/places, which
   keeps the key server-side). Pick a result and we capture name + full address
   + city/state/zip + lat/lng + place_id into hidden inputs. A manual fallback
   covers venues Google doesn't have. Used on the public /proposal page. */

type Suggestion = { placeId: string; primary: string; secondary: string };
type Selected = {
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
};

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-800 dark:text-white";

export default function VenueAutocomplete({
  defaultName,
  defaultAddress,
}: {
  defaultName: string;
  defaultAddress: string;
}) {
  // start "selected" from the event's existing venue (no place_id → confirm
  // action won't clobber stored city/state unless the client re-picks)
  const [selected, setSelected] = useState<Selected | null>(
    defaultName ? { name: defaultName, address: defaultAddress, city: null, state: null, zip: null, lat: null, lng: null, place_id: null } : null
  );
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // debounced autocomplete
  useEffect(() => {
    if (manual || selected || query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        setResults(data.suggestions ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, manual, selected]);

  // close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function pick(s: Suggestion) {
    setOpen(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/places?id=${encodeURIComponent(s.placeId)}`);
      const d = (await res.json()) as Selected;
      setSelected({
        name: d.name || s.primary,
        address: d.address || "",
        city: d.city ?? null,
        state: d.state ?? null,
        zip: d.zip ?? null,
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        place_id: d.place_id ?? s.placeId,
      });
    } finally {
      setLoading(false);
    }
  }

  // ----- manual entry -----
  if (manual) {
    return (
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Venue name</span>
          <input name="venue_name" defaultValue={selected?.name ?? defaultName} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Venue address</span>
          <input name="venue_address" defaultValue={selected?.address ?? defaultAddress} className={inputCls} />
        </label>
        <button
          type="button"
          onClick={() => setManual(false)}
          className="text-xs text-brand underline dark:text-brand-lighter"
        >
          ← search Google Maps instead
        </button>
      </div>
    );
  }

  // ----- selected (from a pick or the existing venue) -----
  if (selected) {
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 dark:border-white/15 dark:bg-white/[0.03]">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{selected.name}</div>
            {selected.address && <div className="truncate text-xs text-zinc-500">{selected.address}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="shrink-0 text-xs text-brand underline dark:text-brand-lighter"
          >
            Change
          </button>
        </div>
        <input type="hidden" name="venue_name" value={selected.name} />
        <input type="hidden" name="venue_address" value={selected.address} />
        {selected.place_id && (
          <>
            <input type="hidden" name="venue_city" value={selected.city ?? ""} />
            <input type="hidden" name="venue_state" value={selected.state ?? ""} />
            <input type="hidden" name="venue_zip" value={selected.zip ?? ""} />
            <input type="hidden" name="venue_lat" value={selected.lat ?? ""} />
            <input type="hidden" name="venue_lng" value={selected.lng ?? ""} />
            <input type="hidden" name="venue_place_id" value={selected.place_id} />
          </>
        )}
      </div>
    );
  }

  // ----- search -----
  return (
    <div className="relative space-y-1" ref={boxRef}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Search for your venue…"
        className={inputCls}
        autoComplete="off"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-800">
          {loading && <div className="px-3 py-2 text-xs text-zinc-400">Searching…</div>}
          {results.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onClick={() => pick(s)}
              className="block w-full px-3 py-2 text-left hover:bg-brand/5"
            >
              <div className="text-sm font-medium text-zinc-900 dark:text-white">{s.primary}</div>
              {s.secondary && <div className="text-xs text-zinc-500">{s.secondary}</div>}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setManual(true)} className="text-xs text-zinc-400 hover:text-zinc-600">
        Can&apos;t find it? Enter manually
      </button>
    </div>
  );
}
