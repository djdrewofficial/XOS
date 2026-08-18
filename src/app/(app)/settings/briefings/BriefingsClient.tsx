"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBriefingPref, setBriefingGlobal, sendBriefingsNow } from "./actions";

export type StaffRow = {
  id: string;
  name: string;
  department: string;
  email: string | null;
  enabled: boolean;
  frequency: string;
  last_sent_on: string | null;
};
export type GlobalCfg = { enabled: boolean; hour: number };

const FREQ = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly (Mondays)" },
];

function hourLabel(h: number) {
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${am ? "AM" : "PM"}`;
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );
}

export default function BriefingsClient({ rows, global }: { rows: StaffRow[]; global: GlobalCfg }) {
  const router = useRouter();
  const [, start] = useTransition();

  const [staff, setStaff] = useState(rows);
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setStaff(rows);
  }

  const [g, setG] = useState(global);
  const [prevG, setPrevG] = useState(global);
  if (global !== prevG) {
    setPrevG(global);
    setG(global);
  }

  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const patch = (id: string, p: Partial<StaffRow>) => setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

  function toggleStaff(s: StaffRow) {
    const enabled = !s.enabled;
    patch(s.id, { enabled });
    start(async () => {
      await setBriefingPref(s.id, { enabled });
      router.refresh();
    });
  }
  function changeFreq(s: StaffRow, frequency: string) {
    patch(s.id, { frequency });
    start(async () => {
      await setBriefingPref(s.id, { frequency });
      router.refresh();
    });
  }
  function toggleGlobal() {
    const enabled = !g.enabled;
    setG({ ...g, enabled });
    start(async () => {
      await setBriefingGlobal({ enabled });
      router.refresh();
    });
  }
  function changeHour(hour: number) {
    setG({ ...g, hour });
    start(async () => {
      await setBriefingGlobal({ hour });
      router.refresh();
    });
  }
  function doSendNow() {
    setSending(true);
    setSendMsg(null);
    start(async () => {
      const res = await sendBriefingsNow();
      setSendMsg(`Sent ${res.sent} briefing${res.sent === 1 ? "" : "s"}.`);
      setSending(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Global controls */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Toggle on={g.enabled} onClick={toggleGlobal} />
            <span className="font-medium">Daily briefings {g.enabled ? "on" : "off"}</span>
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Send at</span>
            <select value={g.hour} onChange={(e) => changeHour(Number(e.target.value))} className="input text-sm">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
            <span className="text-xs text-zinc-400">ET</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {sendMsg && <span className="text-xs text-zinc-500">{sendMsg}</span>}
            <button onClick={doSendNow} disabled={sending} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50">
              {sending ? "Sending…" : "Send now (test)"}
            </button>
          </div>
        </div>
        <p className="text-xs text-zinc-400">
          Each enabled staffer gets their own email with their open tasks and upcoming events. When the whole feature is
          off, no briefings send regardless of individual settings.
        </p>
      </div>

      {/* Per-staff table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2 text-left">Staff</th>
              <th className="px-4 py-2 text-left">Department</th>
              <th className="px-4 py-2 text-left">Gets briefing</th>
              <th className="px-4 py-2 text-left">How often</th>
              <th className="px-4 py-2 text-left">Last sent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {staff.map((s) => (
              <tr key={s.id} className={s.enabled ? "" : "opacity-60"}>
                <td className="px-4 py-2">
                  <div className="font-medium">{s.name}</div>
                  {!s.email && <div className="text-[11px] text-amber-500">no email on file</div>}
                </td>
                <td className="px-4 py-2 text-zinc-500">{s.department}</td>
                <td className="px-4 py-2">
                  <Toggle on={s.enabled} onClick={() => toggleStaff(s)} disabled={!s.email} />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={s.frequency}
                    disabled={!s.enabled}
                    onChange={(e) => changeFreq(s, e.target.value)}
                    className="input text-sm disabled:opacity-50"
                  >
                    {FREQ.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  {s.last_sent_on ? new Date(`${s.last_sent_on}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
