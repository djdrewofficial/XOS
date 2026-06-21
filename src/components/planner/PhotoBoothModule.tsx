"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCamera, faImages, faSpinner, faArrowRotateRight, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import {
  loadPhotoBooth,
  selectBackdrop,
  selectBoothDesign,
  fetchBoothTemplates,
  type BoothBackdrop,
  type BoothDesign,
} from "@/app/portal/plan/[eventId]/actions";

const PER_PAGE = 12; // grid page size

// Curated, fixed option sets (TemplatesBooth values). Designs are always static
// (no welcome screens / animated overlays) and one of these layouts + counts.
const CATEGORIES = [
  { value: "wedding", label: "Wedding" },
  { value: "minimalist", label: "Minimalist" },
  { value: "corporate", label: "Corporate" },
];
const LAYOUTS = [
  { value: "26strip", label: "2×6 Strip" },
  { value: "46postcard-p", label: "4×6 Portrait" },
];
const PHOTO_COUNTS = [
  { value: "1images", label: "1 photo" },
  { value: "3images", label: "3 photos" },
];

type Opt = { value: string; label: string };

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

function normalizeDesigns(payload: unknown): BoothDesign[] {
  return pickArray(payload)
    .map((raw) => {
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
    })
    .filter((d) => d.src);
}

function totalPagesOf(payload: unknown): number {
  if (payload && typeof payload === "object") {
    const tp = (payload as Record<string, unknown>).total_pages;
    if (typeof tp === "number" && tp > 0) return tp;
  }
  return 1;
}

export default function PhotoBoothModule({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const [backdrops, setBackdrops] = useState<BoothBackdrop[]>([]);
  const [backdropId, setBackdropId] = useState<string | null>(null);
  const [design, setDesign] = useState<BoothDesign | null>(null);

  // All three are required (single-select). Defaults: Wedding · 2×6 Strip · 3 photos.
  const [active, setActive] = useState<{ tags: string; layout: string; no_of_images: string }>({
    tags: "wedding",
    layout: "26strip",
    no_of_images: "3images",
  });

  const [designs, setDesigns] = useState<BoothDesign[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [designError, setDesignError] = useState<string | null>(null);
  const reqId = useRef(0);

  const [, startSave] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const pb = await loadPhotoBooth(eventId);
      if (!alive) return;
      setBackdrops(pb.backdrops);
      setBackdropId(pb.selection?.backdrop_id ?? null);
      setDesign(pb.selection?.design ?? null);
    })();
    return () => { alive = false; };
  }, [eventId]);

  const loadDesigns = useCallback(
    async (nextPage: number) => {
      const id = ++reqId.current;
      setLoading(true);
      setDesignError(null);
      const res = await fetchBoothTemplates(eventId, {
        page: nextPage,
        per_page: PER_PAGE,
        type: "static", // exclude welcome screens + animated overlays
        tags: active.tags,
        layout: active.layout,
        no_of_images: active.no_of_images,
      });
      if (id !== reqId.current) return; // superseded
      if (!res.ok) {
        setDesignError(res.error);
        setDesigns([]);
        setLoading(false);
        return;
      }
      setDesigns(normalizeDesigns(res.data));
      setTotalPages(totalPagesOf(res.data));
      setPage(nextPage);
      setLoading(false);
    },
    [eventId, active],
  );

  useEffect(() => { loadDesigns(1); }, [loadDesigns]);

  const setFilter = (key: "tags" | "layout" | "no_of_images", value: string) => {
    if (canEdit) setActive((p) => ({ ...p, [key]: value }));
  };

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {backdrops.map((b) => {
              const sel = b.id === backdropId;
              return (
                <button
                  key={b.id}
                  onClick={() => chooseBackdrop(b)}
                  disabled={!canEdit}
                  className={`group relative overflow-hidden rounded-2xl border-2 text-left transition disabled:cursor-default ${
                    sel ? "border-brand ring-2 ring-brand/30" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.image_url} alt={b.name} className="h-44 w-full object-cover" />
                  {sel && (
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
          {design && <span className="text-zinc-400">· selected</span>}
        </h3>

        <div className="mb-4 space-y-2">
          <FilterRow label="Theme" options={CATEGORIES} active={active.tags} onPick={(v) => setFilter("tags", v)} />
          <FilterRow label="Size" options={LAYOUTS} active={active.layout} onPick={(v) => setFilter("layout", v)} />
          <FilterRow label="Photos" options={PHOTO_COUNTS} active={active.no_of_images} onPick={(v) => setFilter("no_of_images", v)} />
        </div>

        {designError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <p>Couldn&apos;t load designs: {designError}</p>
            <button onClick={() => loadDesigns(1)} className="mt-2 inline-flex items-center gap-2 font-semibold underline">
              <FontAwesomeIcon icon={faArrowRotateRight} /> Try again
            </button>
          </div>
        ) : loading ? (
          <div className="flex h-64 items-center justify-center text-zinc-400">
            <FontAwesomeIcon icon={faSpinner} spin size="lg" />
          </div>
        ) : designs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-400 dark:border-white/10">
            No designs match these options.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {designs.map((d, i) => {
                const sel = design?.src === d.src;
                return (
                  <button
                    key={`${d.src}-${i}`}
                    onClick={() => chooseDesign(d)}
                    disabled={!canEdit}
                    className={`group relative overflow-hidden rounded-2xl border-2 bg-zinc-50 transition disabled:cursor-default dark:bg-white/5 ${
                      sel ? "border-brand ring-2 ring-brand/30" : "border-zinc-200 hover:border-brand/50 dark:border-white/10"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.src} alt={d.type_name ?? "Design"} className="h-56 w-full bg-white object-contain dark:bg-zinc-900" />
                    {sel && (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white shadow">
                        <FontAwesomeIcon icon={faCheck} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-center gap-4">
              <button onClick={() => loadDesigns(page - 1)} disabled={page <= 1} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30">
                <FontAwesomeIcon icon={faChevronLeft} className="mr-1.5" /> Prev
              </button>
              <span className="text-sm font-medium text-zinc-500">Page {page} of {totalPages}</span>
              <button onClick={() => loadDesigns(page + 1)} disabled={page >= totalPages} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30">
                Next <FontAwesomeIcon icon={faChevronRight} className="ml-1.5" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Required single-select chip row (one option always active). */
function FilterRow({ label, options, active, onPick }: { label: string; options: Opt[]; active: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-16 shrink-0 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</span>
      {options.map((o) => {
        const on = active === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              on ? "border-brand bg-brand text-white" : "border-zinc-300 text-zinc-600 hover:border-brand dark:border-white/10 dark:text-zinc-300"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
