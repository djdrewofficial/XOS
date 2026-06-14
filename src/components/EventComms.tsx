"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faPlus } from "@fortawesome/free-solid-svg-icons";
import SaveButton from "@/components/SaveButton";
import { channelIcon, fmtWhen } from "@/app/(app)/inbox/ui";
import { MessageBubble, ReplyForm, ChannelTabs, CHANNEL_TO_TYPE, type MsgRow, type ThreadDoc } from "@/components/MessageParts";
import { startConversation } from "@/app/(app)/inbox/actions";
import type { ConvRow } from "@/components/InboxShell";

/* Event Comms tab — every client on the event (bride, groom, planner…) can
   have their own HighLevel thread; this is a per-person switcher over the
   same live message components the inbox uses. Clients with a cell but no
   thread yet get a "start the conversation" composer. */

export type EventThread = { conv: ConvRow; label: string };
export type StartableClient = { clientId: string; label: string; phone: string };

export default function EventComms({
  eventId,
  threads,
  startable,
  docs = [],
}: {
  eventId: string;
  threads: EventThread[];
  startable: StartableClient[];
  docs?: ThreadDoc[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(threads[0]?.conv.id ?? null);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelView, setChannelView] = useState("all");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => setChannelView("all"), [selectedId]);

  const selected = threads.find((t) => t.conv.id === selectedId) ?? null;
  const selectedStart = startable.find((s) => `start:${s.clientId}` === selectedId) ?? null;

  /* after a first text sends, the server revalidates and the new thread
     arrives in props — switch the start chip over to the real thread */
  useEffect(() => {
    if (selectedId?.startsWith("start:")) {
      const s = startable.find((x) => `start:${x.clientId}` === selectedId);
      const digits = (s?.phone ?? "").replace(/\D/g, "").slice(-10);
      const match = digits
        ? threads.find((t) => (t.conv.phone ?? "").replace(/\D/g, "").endsWith(digits))
        : null;
      if (match) setSelectedId(match.conv.id);
    } else if (!selectedId && threads[0]) {
      setSelectedId(threads[0].conv.id);
    }
  }, [threads, startable, selectedId]);

  /* load + live-subscribe the selected thread */
  useEffect(() => {
    if (!selectedId) return;
    const supabase = createClient();
    let channelSub: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("hl_messages")
        .select("*")
        .eq("conversation_id", selectedId)
        .order("date_added", { ascending: true })
        .limit(500);
      if (!cancelled) {
        setMessages((data ?? []) as MsgRow[]);
        setLoading(false);
      }

      // realtime: JWT must be on the socket BEFORE subscribing (anon gets nothing under RLS)
      const { data: auth } = await supabase.auth.getSession();
      if (auth.session) await supabase.realtime.setAuth(auth.session.access_token);
      if (cancelled) return;
      channelSub = supabase
        .channel(`event-comms-${selectedId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hl_messages" },
          (payload) => {
            const row = payload.new as MsgRow;
            if (!row?.id || row.conversation_id !== selectedId) return;
            setMessages((prev) => {
              const rest = prev.filter((m) => m.id !== row.id);
              return [...rest, row].sort(
                (a, b) => new Date(a.date_added ?? 0).getTime() - new Date(b.date_added ?? 0).getTime()
              );
            });
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channelSub) supabase.removeChannel(channelSub);
    };
  }, [selectedId]);

  /* keep GHL fresh while the tab is open */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        fetch("/api/inbox/tick", { method: "POST" }).catch(() => {});
      }
    };
    tick();
    const interval = setInterval(tick, 25_000);
    return () => clearInterval(interval);
  }, []);

  /* pin to the newest message — including when the tab content first becomes
     visible (Tabs keeps hidden panels at zero height, so a mount-time scroll
     is a no-op until the user actually opens Comms) */
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const scroll = () => {
      el.scrollTop = el.scrollHeight;
    };
    scroll();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) scroll();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [messages.length, selectedId]);

  if (threads.length === 0 && startable.length === 0) {
    return (
      <div className="card px-5 py-10 text-center text-sm text-zinc-400">
        No HighLevel conversations found for this event&apos;s clients yet. Threads match by the client&apos;s cell
        phone or email — add those to the client record and you can start texting from here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* one chip per person/thread — bride and groom text separately */}
      <div className="flex flex-wrap items-center gap-2">
        {threads.map(({ conv, label }) => (
          <button
            key={conv.id}
            type="button"
            onClick={() => setSelectedId(conv.id)}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              conv.id === selectedId
                ? "bg-gradient-to-r from-brand to-brand-light text-white shadow"
                : "border border-zinc-300 text-zinc-600 hover:border-brand hover:text-brand dark:border-white/10 dark:text-zinc-400"
            }`}
          >
            <FontAwesomeIcon icon={channelIcon(conv.last_message_type)} />
            {label}
            {conv.unread_count > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
                {conv.unread_count}
              </span>
            )}
          </button>
        ))}
        {startable.map((s) => (
          <button
            key={s.clientId}
            type="button"
            onClick={() => setSelectedId(`start:${s.clientId}`)}
            className={`flex items-center gap-2 rounded-full border border-dashed px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              `start:${s.clientId}` === selectedId
                ? "border-brand bg-brand/10 text-brand dark:text-brand-lighter"
                : "border-zinc-300 text-zinc-500 hover:border-brand hover:text-brand dark:border-white/15 dark:text-zinc-400"
            }`}
          >
            <FontAwesomeIcon icon={faPlus} />
            {s.label}
          </button>
        ))}
      </div>

      {/* first-text composer for a client with no thread yet */}
      {selectedStart && (
        <div className="card overflow-hidden">
          <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/[0.05]">
            <div className="text-sm font-bold">{selectedStart.label}</div>
            <div className="text-[11px] text-zinc-400">
              {selectedStart.phone} · no conversation yet — your first text starts the thread
            </div>
          </div>
          <form action={startConversation} className="p-4">
            <input type="hidden" name="origin" value={eventId} />
            <input type="hidden" name="phone" value={selectedStart.phone} />
            <input type="hidden" name="client_id" value={selectedStart.clientId} />
            <input type="hidden" name="label" value={selectedStart.label.split(" · ")[0]} />
            <div className="flex items-end gap-2">
              <textarea
                name="body"
                rows={2}
                required
                placeholder={`Text ${selectedStart.label}…`}
                className="input min-h-[3rem] flex-1 resize-y"
              />
              <SaveButton className="btn-primary px-5" savedLabel="Sent">
                Send First Text
              </SaveButton>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="card flex h-[34rem] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-white/[0.05]">
            <div>
              <div className="text-sm font-bold">{selected.label}</div>
              <div className="text-[11px] text-zinc-400">
                {[selected.conv.phone, selected.conv.email].filter(Boolean).join(" · ")}
                {selected.conv.last_message_at ? ` · last activity ${fmtWhen(selected.conv.last_message_at)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ChannelTabs
                conversation={selected.conv}
                messages={messages}
                value={channelView}
                onChange={setChannelView}
              />
              <Link
                href={`/inbox/${selected.conv.id}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline dark:text-brand-lighter"
              >
                Open in Inbox <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" />
              </Link>
            </div>
          </div>
          <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-5">
            {loading && messages.length === 0 && (
              <div className="py-10 text-center text-xs text-zinc-400">Loading…</div>
            )}
            {(channelView === "all"
              ? messages
              : messages.filter((m) => m.message_type === CHANNEL_TO_TYPE[channelView])
            ).map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </div>
          <ReplyForm
            conversation={selected.conv}
            messages={messages}
            title={selected.label}
            docs={docs}
            forcedChannel={channelView === "all" ? null : channelView}
          />
        </div>
      )}
    </div>
  );
}
