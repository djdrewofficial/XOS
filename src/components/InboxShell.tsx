"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SaveButton from "@/components/SaveButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faRotate, faPenToSquare, faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { channelIcon, channelLabel, fmtWhen } from "@/app/(app)/inbox/ui";
import { syncInbox, startConversation } from "@/app/(app)/inbox/actions";
import { MessageBubble, ReplyForm, ChannelTabs, CHANNEL_TO_TYPE, type MsgRow, type ThreadDoc } from "@/components/MessageParts";

export type { MsgRow };

export type ConvRow = {
  id: string;
  hl_contact_id: string | null;
  client_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  last_message_at: string | null;
  last_message_type: string | null;
  last_message_direction: string | null;
  last_message_body: string | null;
  unread_count: number;
};

export type ActiveThread = {
  conv: ConvRow;
  messages: MsgRow[];
  client: { id: string; first_name: string; last_name: string; cell_phone: string | null; email: string | null } | null;
  events: { id: string; name: string; event_date: string | null; status_name: string | null; status_color: string | null; status_text_color: string | null }[];
  ghlUrl: string | null;
  docs: ThreadDoc[];
};

const CHANNELS = [
  ["all", "All"],
  ["TYPE_SMS", "Texts"],
  ["TYPE_CALL", "Calls"],
  ["TYPE_EMAIL", "Email"],
  ["TYPE_WHATSAPP", "WhatsApp"],
  ["social", "Social"],
  ["other", "Other"],
] as const;

const SOCIAL_TYPES = ["TYPE_INSTAGRAM", "TYPE_FACEBOOK", "TYPE_GMB"];
const NAMED_TYPES = ["TYPE_SMS", "TYPE_CALL", "TYPE_EMAIL", "TYPE_WHATSAPP", ...SOCIAL_TYPES];

export type ClientLite = { id: string; first_name: string; last_name: string; cell_phone: string | null };

export default function InboxShell({
  conversations: initialConversations,
  active,
  clients = [],
}: {
  conversations: ConvRow[];
  active: ActiveThread | null;
  clients?: ClientLite[];
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConvRow[]>(initialConversations);
  const [messages, setMessages] = useState<MsgRow[]>(active?.messages ?? []);
  const [channel, setChannel] = useState<string>("all");
  const [q, setQ] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeClient, setComposeClient] = useState("");
  const [composePhone, setComposePhone] = useState("");
  const [channelView, setChannelView] = useState("all");
  const threadRef = useRef<HTMLDivElement>(null);
  const activeId = active?.conv.id ?? null;

  // fresh server props on navigation
  useEffect(() => setConversations(initialConversations), [initialConversations]);
  useEffect(() => {
    setMessages(active?.messages ?? []);
    setChannelView("all");
  }, [activeId, active?.messages]);

  /* ===== realtime: DB changes stream straight into the UI ===== */
  useEffect(() => {
    const supabase = createClient();
    let channelSub: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // the realtime socket must carry the user's JWT — RLS filters events to
      // the authenticated role, and an anon connection silently gets nothing
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channelSub = supabase
        .channel("inbox-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hl_conversations" },
          (payload) => {
            const row = payload.new as ConvRow;
            if (!row?.id) return;
            setConversations((prev) => {
              const rest = prev.filter((c) => c.id !== row.id);
              return [...rest, row].sort(
                (a, b) =>
                  new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()
              );
            });
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hl_messages" },
          (payload) => {
            const row = payload.new as MsgRow;
            if (!row?.id || row.conversation_id !== activeId) return;
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
  }, [activeId]);

  /* ===== light pull every 25s while the inbox is open ===== */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        fetch("/api/inbox/tick", { method: "POST" }).catch(() => {});
      }
    };
    tick();
    const interval = setInterval(tick, 25_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  /* ===== keep the thread pinned to the newest message ===== */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => {
      const type = c.last_message_type ?? "";
      if (channel === "other") {
        if (NAMED_TYPES.includes(type)) return false;
      } else if (channel === "social") {
        if (!SOCIAL_TYPES.includes(type)) return false;
      } else if (channel !== "all" && type !== channel) {
        return false;
      }
      if (!needle) return true;
      return [c.contact_name, c.phone, c.email, c.last_message_body]
        .some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [conversations, channel, q]);

  const title = active
    ? active.conv.contact_name || active.conv.phone || active.conv.email || "Conversation"
    : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-2 md:h-[calc(100vh-6.5rem)] md:gap-4">
      {/* ============ LEFT: conversation list (full-width on mobile, hidden once a thread is open) ============ */}
      <div className={`card ${active ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col overflow-hidden md:w-64 lg:w-80`}>
        <div className="space-y-2 border-b border-zinc-100 p-3 dark:border-white/[0.05]">
          <div className="flex items-center justify-between gap-2">
            <span className="px-1 text-sm font-bold">Conversations</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setComposing((c) => !c)}
                title="New conversation"
                className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                  composing
                    ? "bg-brand/10 text-brand dark:text-brand-lighter"
                    : "text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                }`}
              >
                <FontAwesomeIcon icon={faPenToSquare} />
              </button>
              <form action={syncInbox.bind(null, false)}>
                <SaveButton className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]" savedLabel="✓">
                  <FontAwesomeIcon icon={faRotate} />
                </SaveButton>
              </form>
            </div>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="input w-full"
          />
          <div className="flex flex-wrap gap-1">
            {CHANNELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setChannel(value)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  channel === value
                    ? "bg-gradient-to-r from-brand to-brand-light text-white"
                    : "border border-zinc-200 text-zinc-500 hover:border-brand hover:text-brand dark:border-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/[0.05]">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-zinc-400">No conversations match.</div>
          )}
          {filtered.map((conv) => {
            const unread = conv.unread_count > 0;
            const isActive = conv.id === activeId;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => router.push(`/inbox/${conv.id}`)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                  isActive
                    ? "bg-brand/[0.08] dark:bg-brand/[0.18]"
                    : "hover:bg-black/[0.025] dark:hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs ${
                    unread
                      ? "bg-gradient-to-br from-brand to-brand-light text-white"
                      : "bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400"
                  }`}
                >
                  <FontAwesomeIcon icon={channelIcon(conv.last_message_type)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-[13px] ${unread ? "font-bold" : "font-semibold"}`}>
                      {conv.contact_name || conv.phone || conv.email || "Unknown"}
                    </span>
                    {unread && (
                      <span className="shrink-0 rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">
                        {conv.unread_count}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                      {conv.last_message_at ? fmtWhen(conv.last_message_at) : ""}
                    </span>
                  </span>
                  <span className={`block truncate text-xs ${unread ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400"}`}>
                    {conv.last_message_direction === "outbound" ? "You: " : ""}
                    {conv.last_message_body || channelLabel(conv.last_message_type)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============ CENTER: thread (full-width on mobile when a conversation is open) ============ */}
      <div className={`card ${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col overflow-hidden`}>
        {composing ? (
          <>
            <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/[0.05]">
              <div className="text-sm font-bold">New Conversation</div>
              <div className="text-[11px] text-zinc-400">
                Your first text creates the contact and thread in HighLevel.
              </div>
            </div>
            <form action={startConversation} className="space-y-4 p-5">
              <input type="hidden" name="origin" value="inbox" />
              <input
                type="hidden"
                name="label"
                value={(() => {
                  const c = clients.find((x) => x.id === composeClient);
                  return c ? `${c.first_name} ${c.last_name}`.trim() : "";
                })()}
              />
              <div>
                <label className="label-xs">Client</label>
                <select
                  name="client_id"
                  value={composeClient}
                  onChange={(e) => {
                    setComposeClient(e.target.value);
                    const c = clients.find((x) => x.id === e.target.value);
                    if (c?.cell_phone) setComposePhone(c.cell_phone);
                  }}
                  className="input w-full max-w-sm"
                >
                  <option value="">— custom number —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.cell_phone}>
                      {c.first_name} {c.last_name}
                      {c.cell_phone ? ` · ${c.cell_phone}` : " (no cell on file)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-xs">Phone Number</label>
                <input
                  type="tel"
                  name="phone"
                  required
                  value={composePhone}
                  onChange={(e) => setComposePhone(e.target.value)}
                  placeholder="(954) 555-1234"
                  className="input w-full max-w-sm"
                />
              </div>
              <div>
                <label className="label-xs">Message</label>
                <textarea name="body" rows={3} required className="input w-full" placeholder="Hi! This is Drew from Xpress Entertainment…" />
              </div>
              <div className="flex items-center gap-3">
                <SaveButton className="btn-primary px-6" savedLabel="Sent">
                  Send &amp; Open Thread
                </SaveButton>
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  className="text-xs font-semibold text-zinc-400 hover:text-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        ) : !active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-white/[0.05] md:px-5">
              <div className="flex min-w-0 items-center gap-2">
                {/* back to the conversation list on mobile */}
                <button
                  type="button"
                  onClick={() => router.push("/inbox")}
                  aria-label="Back to inbox"
                  className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] md:hidden"
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{title}</div>
                  <div className="truncate text-[11px] text-zinc-400">
                    {[active.conv.phone, active.conv.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <ChannelTabs
                conversation={active.conv}
                messages={messages}
                value={channelView}
                onChange={setChannelView}
              />
            </div>
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-5">
              {(channelView === "all"
                ? messages
                : messages.filter((m) => m.message_type === CHANNEL_TO_TYPE[channelView])
              ).map((m) => (
                <MessageBubble key={m.id} m={m} />
              ))}
            </div>
            <ReplyForm
              conversation={active.conv}
              messages={messages}
              title={title ?? "client"}
              docs={active.docs}
              forcedChannel={channelView === "all" ? null : channelView}
            />
          </>
        )}
      </div>

      {/* ============ RIGHT: contact / event panel ============ */}
      <div className="card hidden w-72 shrink-0 flex-col gap-0 overflow-y-auto lg:flex">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-4 text-xs text-zinc-400">
            Contact details appear here
          </div>
        ) : (
          <>
            <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white">
              Contact
            </div>
            <div className="space-y-1 px-4 py-3">
              <div className="text-sm font-bold">{title}</div>
              {active.conv.phone && <div className="text-xs text-zinc-500">{active.conv.phone}</div>}
              {active.conv.email && <div className="break-all text-xs text-zinc-500">{active.conv.email}</div>}
              {active.ghlUrl && (
                <a
                  href={active.ghlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-brand hover:underline dark:text-brand-lighter"
                >
                  Open in HighLevel <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" />
                </a>
              )}
            </div>

            <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white">
              XOS Client
            </div>
            <div className="px-4 py-3">
              {active.client ? (
                <Link
                  href={`/clients/${active.client.id}`}
                  className="block rounded-lg border border-zinc-200 px-3 py-2.5 transition-colors hover:border-brand dark:border-white/10"
                >
                  <div className="text-sm font-semibold">
                    {active.client.first_name} {active.client.last_name}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {[active.client.cell_phone, active.client.email].filter(Boolean).join(" · ") || "View client →"}
                  </div>
                </Link>
              ) : (
                <p className="text-xs text-zinc-400">
                  Not linked to an XOS client — matching runs on each sync (by cell phone or email).
                </p>
              )}
            </div>

            <div className="bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white">
              Events
            </div>
            <div className="space-y-2 px-4 py-3">
              {active.events.length === 0 && (
                <p className="text-xs text-zinc-400">
                  {active.client ? "No events for this client yet." : "Link a client to see their events."}
                </p>
              )}
              {active.events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="block rounded-lg border border-zinc-200 px-3 py-2.5 transition-colors hover:border-brand dark:border-white/10"
                >
                  <div className="truncate text-sm font-semibold">{ev.name}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      {ev.event_date
                        ? new Date(`${ev.event_date}T00:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "No date"}
                    </span>
                    {ev.status_name && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          backgroundColor: ev.status_color ?? "#eee",
                          color: ev.status_text_color ?? "#000",
                        }}
                      >
                        {ev.status_name}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
