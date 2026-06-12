"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/* Catalog save control: every package/add-on save asks whether this edit is a
   typo fix ("Update Current Version" — history rewritten in place) or a real
   change ("Create New Version" — events keep the version they signed with). */
export default function VersionSaveButtons({ currentVersion }: { currentVersion: number }) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2200);
      return () => clearTimeout(t);
    }
  }, [pending]);

  if (pending) {
    return (
      <button disabled className="btn-primary cursor-wait gap-2">
        <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        Saving…
      </button>
    );
  }

  if (saved) {
    return (
      <button
        type="button"
        className="btn-primary pointer-events-none gap-1.5 saved-flash"
        style={{ backgroundImage: "none", backgroundColor: "var(--color-brand, #4b328e)", color: "#fff" }}
      >
        <span className="text-base leading-none">✓</span> Saved
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        name="version_mode"
        value="current"
        title="Typo fix — rewrites version history in place; events already on this version see the correction"
        className="btn-ghost px-4 py-2 text-xs"
      >
        Update Current Version (v{currentVersion})
      </button>
      <button
        name="version_mode"
        value="new"
        title="Real change — events keep the version they were sold with; new events get the new version"
        className="btn-primary px-4 py-2 text-xs"
      >
        Create New Version (v{currentVersion + 1})
      </button>
    </div>
  );
}
