"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCamera, faImages, faSpinner, faArrowRotateRight } from "@fortawesome/free-solid-svg-icons";
import {
  loadPhotoBooth,
  selectBackdrop,
  selectBoothDesign,
  fetchBoothTemplates,
  fetchBoothFilters,
  type BoothBackdrop,
  type BoothDesign,
} from "@/app/portal/plan/[eventId]/actions";

const PER_PAGE = 24;

/** Pull the design array out of whatever envelope TemplatesBooth returns
    (array, {data}, {templates}, {items}, {results}). Maps to our BoothDesign. */
function normalizeDesigns(payload: unknown): BoothDesign[] {
  const arr = pickArray(payload);
  return arr.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const str = (k: string) => (o[k] == null ? null : String(o[k]));
    return {
      src: str("src") ?? str("thumbnail") ?? str("image") ?? "",
      post_url: str("post_url"),
      layout_size: str("layout_size"),
      image_type: str("image_type"),
      no_of_images: str("no_of_images"),
      type: str("type"),
      type_name: str("type_name"),
      video_url: str("video_url"),
      poster: str("poster"),
    };
  }).filter((d) => d.src);
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["data", "templates", "items", "results", "rows"]) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

type FilterValues = {
  no_of_images: string[];
  layout: string[];
  type: { value: string; label: string }[];
};

function normalizeFilters(payload: unknown): FilterValues {
  const o = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x && typeof x === "object" && "value" in x ? String((x as { value: unknown }).value) : String(x))).filter(Boolean) : [];
  const typed = (v: unknown): { value: string; label: string }[] =>
    Array.isArray(v)
      ? v
          .map((x) =>
            x && typeof x === "object"
              ? { value: String((x as Record<string, unknown>).value ?? (x as Record<string, unknown>).slug ?? ""), label: String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name ?? (x as Record<string, unknown>).value ?? "") }
              : { value: String(x), label: String(x) },
          )
          .filter((t) => t.value)
      : [];
  return {
    no_of_images: list(o.no_of_images),
    layout: list(o.layout_size ?? o.layout),
    type: typed(o.type),
  };
}

export default function PhotoBoothModule({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const [backdrops, setBackdrops] = useState<BoothBackdrop[]>([]);
  const [backdropId, setBackdropId] = useState<string | null>(null);
  const [design, setDesign] = useState<BoothDesign | null>(null);

  const [filters, setFilters] = useState<FilterValues>({ no_of_images: [], layout: [], type: [] });
  const [activeFilters, setActiveFilters] = useState<{ no_of_images?: string; layout?: string; type?: string }>({});

  const [designs, setDesigns] = useState<BoothDesign[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingDesigns, setLoadingDesigns] = useState(true);
  const [designError, setDesignError] = useState<string | null>(null);
  const reqId = useRef(0);

  const [, startSave] = useTransition();

  // Initial: saved selection + backdrops + filter values.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [pb, f] = await Promise.all([loadPhotoBooth(eventId), fetchBoothFilters(eventId)]);
      if (!alive) return;
      setBackdrops(pb.backdrops);
      setBackdropId(pb.selection?.backdrop_id ?? null);
      setDesign(pb.selection?.design ?? null);
      if (f.ok) setFilters(normalizeFilters(f.data));
    })();
    return () => { alive = false; };
  }, [eventId]);

  // (Re)load designs whenever filters change.
  const loadDesigns = useCallback(
    async (nextPage: number, replace: boolean) => {
      const id = ++reqId.current;
      setLoadingDesigns(true);
      setDesignError(null);
      const res = await fetchBoothTemplates(eventId, {
        page: nextPage,
        per_page: PER_PAGE,
        ...(activeFilters.no_of_images ? { no_of_images: activeFilters.no_of_images } : {}),
        ...(activeFilters.layout ? { layout: activeFilters.layout } : {}),
        ...(activeFilters.type ? { type: activeFilters.type } : {}),
      });
      if (id !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) {
        setDesignError(res.error);
        setLoadingDesigns(false);
        if (replace) setDesigns([]);
        return;
      }
      const items = normalizeDesigns(res.data);
      setHasMore(items.length >= PER_PAGE);
      setDesigns((prev) => (replace ? items : [...prev, ...items]));
      setPage(nextPage);
      setLoadingDesigns(false);
    },
    [eventId, activeFilters],
  );

  useEffect(() => {
    loadDesigns(1, true);
  }, [loadDesigns]);

  function toggleFilter(key: "no_of_images" | "layout" | "type", value: string) {
    if (!canEdit) return;
    setActiveFilters((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
  }

  function chooseBackdrop(b: BoothBackdrop) {
    if (!canEdit) return;
    setBackdropId(b.id);
    startSave(() => { selectBackdrop(eventId, b.id); });
  }
  function chooseDesign(d: BoothDesign) {
    if (!canEdit) return;
    setDesign(d);
    startSave(() => { selectBoothDesign(eventId, d); });
  }

  return (
    <div className="space-y-8">
      <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand dark:text-brand-lighter">
        <FontAwesomeIcon icon={faCamera} /> Pick your backdrop &amp; photo-strip design — saved straight to your event
      </div>

      {/* ── Backdrop gallery ── */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faImages} /> Backdrop
          {backdropId && <span className="text-zinc-400">· selected</span>}
        </h3>
        {backdrops.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-400 dark:border-white/10">
            No backdrops available yet — check back soon!
          </p>
        ) : (
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
            {backdrops.map((b) => {
              const active = b.id === backdropId;
              return (
                <button
                  key={b.id}
                  onClick={() => chooseBackdrop(b)}
                  disabled={!canEdit}
                  className={`group relative w-40 shrink-0 snap-start overflow-hidden rounded-2xl border-2 text-left transition disabled:cursor-default ${
                    active ? "border-brand ring-2 ring-brand/30" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.image_url} alt={b.name} className="h-52 w-full object-cover" />
                  {active && (
                    <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white shadow">
                      <FontAwesomeIcon icon={faCheck} />
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <p className="truncate text-xs font-semibold text-white">{b.name}</p>
                    {b.category && <p className="truncate text-[10px] text-white/70">{b.category}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Design picker ── */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faCamera} /> Photo-strip design
          {design && <span className="text-zinc-400">· {design.type_name ?? "selected"}</span>}
        </h3>

        {/* Filters */}
        <div className="mb-4 space-y-2">
          <FilterRow label="Photos" values={filters.no_of_images} active={activeFilters.no_of_images} onPick={(v) => toggleFilter("no_of_images", v)} />
          <FilterRow label="Layout" values={filters.layout} active={activeFilters.layout} onPick={(v) => toggleFilter("layout", v)} />
          <FilterRow
            label="Type"
            values={filters.type.map((t) => t.value)}
            labels={Object.fromEntries(filters.type.map((t) => [t.value, t.label]))}
            active={activeFilters.type}
            onPick={(v) => toggleFilter("type", v)}
          />
        </div>

        {designError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <p>Couldn&apos;t load designs: {designError}</p>
            <button onClick={() => loadDesigns(1, true)} className="mt-2 inline-flex items-center gap-2 font-semibold underline">
              <FontAwesomeIcon icon={faArrowRotateRight} /> Try again
            </button>
          </div>
        ) : (
          <>
            <div className="flex snap-x gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
              {designs.map((d, i) => {
                const active = design?.src === d.src;
                return (
                  <button
                    key={`${d.src}-${i}`}
                    onClick={() => chooseDesign(d)}
                    disabled={!canEdit}
                    className={`group relative w-36 shrink-0 snap-start overflow-hidden rounded-2xl border-2 bg-zinc-50 transition disabled:cursor-default dark:bg-white/5 ${
                      active ? "border-brand ring-2 ring-brand/30" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.src} alt={d.type_name ?? "Design"} className="h-56 w-full object-contain" />
                    {active && (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white shadow">
                        <FontAwesomeIcon icon={faCheck} />
                      </span>
                    )}
                    {(d.no_of_images || d.type_name) && (
                      <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                        {d.no_of_images && <span className="rounded bg-white/20 px-1 text-[9px] font-semibold text-white">{d.no_of_images}</span>}
                        {d.type_name && <span className="rounded bg-white/20 px-1 text-[9px] font-semibold text-white">{d.type_name}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
              {loadingDesigns && (
                <div className="flex w-36 shrink-0 items-center justify-center rounded-2xl border border-dashed border-zinc-200 text-zinc-400 dark:border-white/10">
                  <FontAwesomeIcon icon={faSpinner} spin />
                </div>
              )}
            </div>

            {!loadingDesigns && designs.length === 0 && (
              <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-400 dark:border-white/10">
                No designs match these filters.
              </p>
            )}

            {hasMore && designs.length > 0 && !loadingDesigns && (
              <div className="mt-2 text-center">
                <button onClick={() => loadDesigns(page + 1, false)} className="btn-ghost px-4 py-2 text-sm">
                  Load more designs
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FilterRow({
  label,
  values,
  labels,
  active,
  onPick,
}: {
  label: string;
  values: string[];
  labels?: Record<string, string>;
  active: string | undefined;
  onPick: (v: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-14 shrink-0 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</span>
      {values.map((v) => {
        const on = active === v;
        return (
          <button
            key={v}
            onClick={() => onPick(v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              on ? "border-brand bg-brand text-white" : "border-zinc-300 text-zinc-600 hover:border-brand dark:border-white/10 dark:text-zinc-300"
            }`}
          >
            {labels?.[v] ?? v}
          </button>
        );
      })}
    </div>
  );
}
