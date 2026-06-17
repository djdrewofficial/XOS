"use client";

import { useState } from "react";
import { selfCheckInOut, requestTimesheetChange } from "@/app/(app)/events/actions";

const fmt = (t: string | null) => (t ? new Date(t).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : null);

/* Staff self check-in/out for one of their assignments + a correction request. */
export default function StaffCheckIn({
  eventStaffId,
  checkedInAt,
  checkedOutAt,
}: {
  eventStaffId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}) {
  const [fixing, setFixing] = useState(false);

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {!checkedInAt ? (
          <form action={selfCheckInOut.bind(null, eventStaffId, "checked_in_at")}>
            <button className="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700">Check In</button>
          </form>
        ) : !checkedOutAt ? (
          <>
            <span className="text-zinc-500">In {fmt(checkedInAt)}</span>
            <form action={selfCheckInOut.bind(null, eventStaffId, "checked_out_at")}>
              <button className="rounded-md bg-zinc-700 px-2 py-1 font-semibold text-white hover:bg-zinc-800">Check Out</button>
            </form>
          </>
        ) : (
          <span className="text-zinc-500">In {fmt(checkedInAt)} · Out {fmt(checkedOutAt)}</span>
        )}
        <button type="button" onClick={() => setFixing((v) => !v)} className="text-zinc-400 hover:text-zinc-600 hover:underline dark:hover:text-zinc-300">
          request fix
        </button>
      </div>

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
            <button type="submit" className="rounded-md bg-brand px-2 py-1 font-semibold text-white">Request</button>
          </div>
        </form>
      )}
    </div>
  );
}
