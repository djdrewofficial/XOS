import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

/** Warn-only banner listing the signing requirements still missing on an event.
 *  Renders nothing when nothing is missing. Configured in Settings → Signing
 *  Requirements; checks live in src/lib/signingRequirements.ts. */
export default function SigningChecklist({ missing }: { missing: { key: string; label: string }[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
        <FontAwesomeIcon icon={faTriangleExclamation} />
        Missing info before sending the quote ({missing.length})
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {missing.map((m) => (
          <span
            key={m.key}
            className="rounded-md border border-amber-300 bg-white/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-black/20 dark:text-amber-200"
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
        These are recommended before sending the proposal — they won&apos;t block you. Edit which fields are required in{" "}
        <a href="/settings/signing" className="font-semibold underline">
          Settings → Signing Requirements
        </a>
        .
      </div>
    </div>
  );
}
