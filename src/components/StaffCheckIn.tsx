"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PendingSubmit from "@/components/PendingSubmit";
import { selfPunch } from "@/app/(app)/time-clock/actions";
import { requestTimesheetChange } from "@/app/(app)/events/actions";

const fmt = (t: string | null) => (t ? new Date(t).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : null);

type LocPayload = {
  lat: string;
  lng: string;
  accuracy_m: string;
  location_missing: "0" | "1";
};

function readGeo(): Promise<LocPayload> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: "", lng: "", accuracy_m: "", location_missing: "1" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: String(pos.coords.latitude),
          lng: String(pos.coords.longitude),
          accuracy_m: String(pos.coords.accuracy ?? ""),
          location_missing: "0",
        });
      },
      () => resolve({ lat: "", lng: "", accuracy_m: "", location_missing: "1" }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }
    );
  });
}

/* Staff self check-in/out for one assignment. Geolocation is requested only on tap. */
export default function StaffCheckIn({
  eventStaffId,
  checkedInAt,
  checkedOutAt,
  enabled = true,
  openPunch = false,
}: {
  eventStaffId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** When false (feat_check_in_out / time clock off), show status only. */
  enabled?: boolean;
  /** True when there is an unmatched in punch (re-clock / mid-shift). */
  openPunch?: boolean;
}) {
  const router = useRouter();
  const [fixing, setFixing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needsOut = openPunch || (!!checkedInAt && !checkedOutAt);
  const label = !checkedInAt && !openPunch ? "Clock In" : needsOut ? "Clock Out" : "Clock In again";

  function onPunch() {
    setErr(null);
    start(async () => {
      try {
        const geo = await readGeo();
        const fd = new FormData();
        fd.set("lat", geo.lat);
        fd.set("lng", geo.lng);
        fd.set("accuracy_m", geo.accuracy_m);
        fd.set("location_missing", geo.location_missing);
        fd.set("punched_at", new Date().toISOString());
        await selfPunch(eventStaffId, fd);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Punch failed.");
      }
    });
  }

  if (!enabled) {
    return (
      <div className="text-xs text-zinc-500">
        {checkedInAt ? (
          <>In {fmt(checkedInAt)}{checkedOutAt ? ` · Out ${fmt(checkedOutAt)}` : ""}</>
        ) : (
          "Time clock off"
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {checkedInAt && (
          <span className="text-zinc-500">
            In {fmt(checkedInAt)}
            {checkedOutAt ? ` · Out ${fmt(checkedOutAt)}` : needsOut ? " · open" : ""}
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={onPunch}
          className={`rounded-md px-2 py-1 font-semibold text-white disabled:opacity-60 ${
            needsOut ? "bg-zinc-700 hover:bg-zinc-800" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {pending ? "Locating…" : label}
        </button>
        <button
          type="button"
          onClick={() => setFixing((v) => !v)}
          className="text-zinc-400 hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
        >
          request fix
        </button>
      </div>
      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}

      {fixing && (
        <form action={requestTimesheetChange.bind(null, eventStaffId)} className="mt-1 space-y-1 rounded-md border border-zinc-200 bg-white p-2 dark:border-white/10 dark:bg-zinc-900">
          <label className="block">
            <span className="text-[10px] text-zinc-500">Correct check-in</span>
            <input type="datetime-local" name="check_in" className="input w-full py-1 text-xs" />
          </label>
          <label className="block">
            <span className="text-[10px] text-zinc-500">Correct check-out</span>
            <input type="datetime-local" name="check_out" className="input w-full py-1 text-xs" />
          </label>
          <input name="reason" placeholder="Reason (optional)" className="input w-full py-1 text-xs" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFixing(false)} className="px-2 py-1 text-zinc-500">Cancel</button>
            <PendingSubmit pendingLabel="Sending…" className="rounded-md bg-brand px-2 py-1 font-semibold text-white disabled:opacity-60">
              Request
            </PendingSubmit>
          </div>
        </form>
      )}
    </div>
  );
}
