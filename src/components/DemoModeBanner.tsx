import { demoModeBannerCopy, type DemoBannerAudience } from "@/lib/demoModeCopy";

/** Amber banner for Demo Mode on staff, host, guest, and join surfaces. */
export function DemoModeBanner({
  className = "",
  audience = "staff",
  bilingual = false,
}: {
  className?: string;
  audience?: DemoBannerAudience;
  /** When true, show English and Spanish (join flow / bilingual surfaces). */
  bilingual?: boolean;
}) {
  const copy = demoModeBannerCopy(audience);
  return (
    <div
      className={`flex flex-wrap items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 ${className}`}
      role="status"
    >
      <span className="mt-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        Demo Mode
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p>{copy.en}</p>
        {bilingual && <p lang="es">{copy.es}</p>}
      </div>
    </div>
  );
}
