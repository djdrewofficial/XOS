/* Shown the moment a staff navigation starts, before the next page's queries
   finish. Without this, a slow screen looks like the click did nothing. */
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-semibold text-zinc-500">
        <span className="inline-block size-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
        Loading…
      </div>
    </div>
  );
}
