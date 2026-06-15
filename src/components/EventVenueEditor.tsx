"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import EntityPicker from "@/components/EntityPicker";
import VenueAutocomplete from "@/components/VenueAutocomplete";

/* Venue editor for the event page: change to an existing venue, or "Create New
   Venue" from Google (imports the address). Mirrors the onboarding venue tab. */

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save Venue"}
    </button>
  );
}

export default function EventVenueEditor({
  action,
  hasVenue,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  hasVenue: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const ref = useRef<HTMLDivElement>(null);

  function readNewVenue(): Record<string, unknown> | null {
    const root = ref.current;
    if (!root) return null;
    const g = (n: string) => (root.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value || null;
    const nm = g("venue_name");
    if (!nm) return null;
    return {
      name: nm,
      address: g("venue_address"),
      city: g("venue_city"),
      state: g("venue_state"),
      zip: g("venue_zip"),
      lat: g("venue_lat") ? Number(g("venue_lat")) : null,
      lng: g("venue_lng") ? Number(g("venue_lng")) : null,
      place_id: g("venue_place_id"),
    };
  }

  if (!editing) {
    return (
      <div>
        {children}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-brand hover:text-brand dark:border-white/15 dark:text-zinc-300"
        >
          {hasVenue ? "Change Venue" : "Select Venue"}
        </button>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        if (mode === "new") {
          fd.delete("venue_id");
          fd.set("new_venue_json", JSON.stringify(readNewVenue()));
        } else {
          fd.set("new_venue_json", "null");
        }
        await action(fd);
        setEditing(false);
      }}
      className="space-y-3"
    >
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.06]">
        {([["existing", "From our list"], ["new", "New (Google)"]] as const).map(([m, lbl]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${mode === m ? "bg-white text-brand shadow dark:bg-zinc-800 dark:text-brand-lighter" : "text-zinc-500"}`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {mode === "existing" ? (
        <EntityPicker kind="venue" name="venue_id" />
      ) : (
        <div ref={ref}>
          <VenueAutocomplete defaultName="" defaultAddress="" />
          <p className="mt-1 text-[11px] text-zinc-400">Pick a Google result to import its address as a new venue.</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <SaveBtn />
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
