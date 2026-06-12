"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faMoneyBillWave, faUmbrellaBeach, faEnvelopeOpenText, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  created_at: string;
  read_at: string | null;
};

const TYPE_ICONS: Record<string, IconDefinition> = {
  new_payment_received: faMoneyBillWave,
  unassigned_pending_payments: faCircleExclamation,
  time_off_requests: faUmbrellaBeach,
  email_bounced: faEnvelopeOpenText,
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* audio blocked until first user interaction — fine */
  }
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const soundOn = useRef(false);
  const prevUnread = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { count }, { data: cs }] = await Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
      supabase.from("company_settings").select("notif_sound").eq("id", true).maybeSingle(),
    ]);
    soundOn.current = Boolean(cs?.notif_sound);
    setItems((data as Notification[]) ?? []);
    const n = count ?? 0;
    if (prevUnread.current !== null && n > prevUnread.current && soundOn.current) beep();
    prevUnread.current = n;
    setUnread(n);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function openNotification(n: Notification) {
    setOpen(false);
    if (!n.read_at) {
      const supabase = createClient();
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      void load();
    }
    if (n.href) router.push(n.href);
  }

  async function markAllRead() {
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    void load();
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className={`group relative flex size-9 items-center justify-center rounded-lg transition-all ${
          open
            ? "bg-gradient-to-r from-brand to-brand-light text-white shadow-lg shadow-brand/40"
            : "text-zinc-500 hover:bg-black/[0.05] hover:text-brand dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-brand-lighter"
        }`}
      >
        <FontAwesomeIcon icon={faBell} className="text-[15px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-brand to-brand-light px-1 text-[9px] font-black text-white shadow ring-2 ring-white dark:ring-zinc-950">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        {!open && (
          <span className="pointer-events-none absolute top-full mt-2 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white shadow-lg group-hover:block dark:bg-white dark:text-zinc-900">
            Notifications
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-zinc-900 dark:bg-white" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-96 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-white/[0.06]">
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-brand hover:underline dark:text-brand-lighter">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-zinc-500">You&apos;re all caught up.</p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void openNotification(n)}
                className={`flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left last:border-b-0 hover:bg-black/[0.03] dark:border-white/[0.05] dark:hover:bg-white/[0.04] ${
                  n.read_at ? "opacity-60" : ""
                }`}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-xs text-brand dark:bg-brand-light/15 dark:text-brand-lighter">
                  <FontAwesomeIcon icon={TYPE_ICONS[n.type] ?? faBell} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-zinc-500">{n.body}</span>}
                  <span className="block text-[10px] uppercase tracking-wide text-zinc-400">{timeAgo(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-light" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
