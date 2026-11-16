"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminUpsertPunch, approveTimesheet, unlockTimesheet } from "@/app/(app)/time-clock/actions";

export type PunchRow = {
  id: string;
  punch_type: string;
  punched_at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  location_missing: boolean;
  source: string;
  note: string | null;
  deleted_at: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function mapUrl(punches: PunchRow[]): string | null {
  const pts = punches.filter((p) => !p.deleted_at && p.lat != null && p.lng != null);
  if (!pts.length) return null;
  // OSM static-ish deep link with markers via openstreetmap (no API key)
  const last = pts[pts.length - 1];
  const markers = pts
    .slice(0, 8)
    .map((p) => `marker=${p.lat}%2C${p.lng}`)
    .join("&");
  return `https://www.openstreetmap.org/?mlat=${last.lat}&mlon=${last.lng}#map=15/${last.lat}/${last.lng}&${markers}`;
}

export default function AdminPunchPanel({
  eventStaffId,
  punches,
  payType,
  timesheetStatus,
  timesheetHours,
  timesheetAmount,
  canEdit,
}: {
  eventStaffId: string;
  punches: PunchRow[];
  payType: string;
  timesheetStatus: string;
  timesheetHours: number | null;
  timesheetAmount: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const live = useMemo(() => punches.filter((p) => !p.deleted_at).sort((a, b) => a.punched_at.localeCompare(b.punched_at)), [punches]);
  const osm = mapUrl(live);

  function run(fn: () => Promise<void>) {
    setErr(null);
    start(async () => {
      try {
        await fn();
        setReason("");
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed.");
      }
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 bg-black/[0.02] p-3 text-xs dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-zinc-800 dark:text-zinc-200">
          Punches
          {payType === "hourly" && (
            <span className="ml-2 font-normal text-zinc-500">
              · {timesheetStatus}
              {timesheetHours != null ? ` · ${Number(timesheetHours).toFixed(2)}h` : ""}
              {timesheetAmount != null ? ` · $${Number(timesheetAmount).toFixed(2)}` : ""}
            </span>
          )}
        </div>
        {osm && (
          <a href={osm} target="_blank" rel="noreferrer" className="text-brand hover:underline dark:text-brand-lighter">
            Open map ({live.filter((p) => p.lat != null).length} pins)
          </a>
        )}
      </div>

      <ul className="space-y-1">
        {live.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1.5 dark:bg-zinc-900">
            <div>
              <span className={`font-bold uppercase ${p.punch_type === "in" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600"}`}>
                {p.punch_type}
              </span>{" "}
              {fmt(p.punched_at)}
              {p.location_missing ? (
                <span className="ml-1 text-amber-700 dark:text-amber-300">· no location</span>
              ) : p.distance_m != null ? (
                <span className="ml-1 text-zinc-500">· {(Number(p.distance_m) / 1609.34).toFixed(2)} mi from venue</span>
              ) : null}
              {p.lat != null && p.lng != null && (
                <a
                  className="ml-1 text-brand hover:underline dark:text-brand-lighter"
                  href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  pin
                </a>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                disabled={pending || !reason.trim()}
                className="text-red-600 hover:underline disabled:opacity-40"
                onClick={() =>
                  run(async () => {
                    const fd = new FormData();
                    fd.set("action", "delete");
                    fd.set("punch_id", p.id);
                    fd.set("reason", reason);
                    await adminUpsertPunch(fd);
                  })
                }
              >
                Delete
              </button>
            )}
          </li>
        ))}
        {live.length === 0 && <li className="text-zinc-500">No punches yet.</li>}
      </ul>

      {canEdit && (
        <div className="space-y-2 border-t border-zinc-200 pt-2 dark:border-white/10">
          <label className="block">
            <span className="text-[10px] text-zinc-500">Reason (required for admin changes)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input w-full py-1 text-xs" placeholder="e.g. Missed clock-out, phone died" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              className="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white disabled:opacity-40"
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("action", "insert");
                  fd.set("event_staff_id", eventStaffId);
                  fd.set("punch_type", "in");
                  fd.set("punched_at", new Date().toISOString());
                  fd.set("location_missing", "1");
                  fd.set("reason", reason);
                  await adminUpsertPunch(fd);
                })
              }
            >
              Add In
            </button>
            <button
              type="button"
              disabled={pending || !reason.trim()}
              className="rounded-md bg-zinc-700 px-2 py-1 font-semibold text-white disabled:opacity-40"
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("action", "insert");
                  fd.set("event_staff_id", eventStaffId);
                  fd.set("punch_type", "out");
                  fd.set("punched_at", new Date().toISOString());
                  fd.set("location_missing", "1");
                  fd.set("reason", reason);
                  await adminUpsertPunch(fd);
                })
              }
            >
              Add Out
            </button>
            {payType === "hourly" && timesheetStatus !== "locked" && timesheetStatus !== "paid" && (
              <button
                type="button"
                disabled={pending}
                className="rounded-md bg-brand px-2 py-1 font-semibold text-white disabled:opacity-40"
                onClick={() => run(() => approveTimesheet(eventStaffId))}
              >
                Approve & lock
              </button>
            )}
            {payType === "hourly" && (timesheetStatus === "locked" || timesheetStatus === "approved") && (
              <button
                type="button"
                disabled={pending || !reason.trim()}
                className="rounded-md border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-40 dark:border-white/20"
                onClick={() =>
                  run(async () => {
                    const fd = new FormData();
                    fd.set("reason", reason);
                    await unlockTimesheet(eventStaffId, fd);
                  })
                }
              >
                Unlock
              </button>
            )}
          </div>
        </div>
      )}
      {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
