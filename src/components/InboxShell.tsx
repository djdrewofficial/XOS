"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SaveButton from "@/components/SaveButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faRotate, faPaperclip, faFile } from "@fortawesome/free-solid-svg-icons";
import { channelIcon, channelLabel, fmtWhen, fmtFull } from "@/app/(app)/inbox/ui";
import { sendInboxReply, syncInbox } from "@/app/(app)/inbox/actions";

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

export type MsgRow = {
  id: string;
  conversation_id: string;
  direction: string | null;
  message_type: string | null;
  status: string | null;
  body: string | null;
  date_added: string | null;
  meta: Record<string, unknown> | null;
};

export type ActiveThread = {
  conv: ConvRow;
  messages: MsgRow[];
  client: { id: string; first_name: string; last_name: string; cell_phone: string | null; email: string | null } | null;
  events: { id: string; name: string; event_date: string | null; status_name: string | null; status_color: string | null; status_text_color: string | null }[];
  ghlUrl: string | null;
};

const CHANNELS = [
  ["all", "All"],
  ["TYPE_SMS", "Texts"],
  ["TYPE_CALL", "Calls"],
  ["TYPE_EMAIL", "Email"],
  ["other", "Other"],
] as const;

const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic)(\?|$)/i;

/** GHL stores attachments as URL strings (ours and theirs both end up on their CDN). */
function attachmentUrls(meta: Record<string, unknown> | null): string[] {
  const raw = (meta as { attachments?: unknown })?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === "string" ? a : (a as { url?: string })?.url ?? ""))
    .filter(Boolean);
}

function AttachmentList({ urls, out }: { urls: string[]; out: boolean }) {
  if (!urls.length) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {urls.map((url) =>
        IMAGE_RE.test(url) ? (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="attachment" className="max-h-60 max-w-full rounded-lg" />
          </a>
        ) : (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              out ? "bg-white/15 text-white" : "bg-black/[0.06] text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
            }`}
          >
            <FontAwesomeIcon icon={faFile} />
            <span className="truncate">{decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "file")}</span>
          </a>
        )
      )}
    </div>
  );
}

export default function InboxShell({
  conversations: initialConversations,
  active,
}: {
  conversations: ConvRow[];
  active: ActiveThread | null;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConvRow[]>(initialConversations);
  const [messages, setMessages] = useState<MsgRow[]>(active?.messages ?? []);
  const [channel, setChannel] = useState<string>("all");
  const [q, setQ] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const activeId = active?.conv.id ?? null;

  // fresh server props on navigation
  useEffect(() => setConversations(initialConversations), [initialConversations]);
  useEffect(() => setMessages(active?.messages ?? []), [activeId, active?.messages]);

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
      if (channel === "other") {
        if (["TYPE_SMS", "TYPE_CALL", "TYPE_EMAIL"].includes(c.last_message_type ?? "")) return false;
      } else if (channel !== "all" && c.last_message_type !== channel) {
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
    <div className="flex h-[calc(100vh-6.5rem)] gap-4">
      {/* ============ LEFT: conversation list ============ */}
      <div className="card flex w-80 shrink-0 flex-col overflow-hidden">
        <div className="space-y-2 border-b border-zinc-100 p-3 dark:border-white/[0.05]">
          <div className="flex items-center justify-between gap-2">
            <span className="px-1 text-sm font-bold">Conversations</span>
            <form action={syncInbox.bind(null, false)}>
              <SaveButton className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]" savedLabel="✓">
                <FontAwesomeIcon icon={faRotate} />
              </SaveButton>
            </form>
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

      {/* ============ CENTER: thread ============ */}
      <div className="card flex min-w-0 flex-1 flex-col overflow-hidden">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/[0.05]">
              <div className="text-sm font-bold">{title}</div>
              <div className="text-[11px] text-zinc-400">
                {[active.conv.phone, active.conv.email].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((m) => {
                const out = m.direction === "outbound";
                const isText = m.message_type === "TYPE_SMS" || m.message_type === "TYPE_WHATSAPP";
                const meta = (m.meta ?? {}) as { callDuration?: number };
                return (
                  <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        out
                          ? "rounded-br-sm bg-gradient-to-br from-brand to-brand-light text-white"
                          : "rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-white/[0.07] dark:text-zinc-100"
                      }`}
                    >
                      {!isText && (
                        <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${out ? "text-white/80" : "text-zinc-500"}`}>
                          <FontAwesomeIcon icon={channelIcon(m.message_type)} />
                          {channelLabel(m.message_type)}
                          {m.message_type === "TYPE_CALL" && meta.callDuration != null && (
                            <span className="font-normal normal-case">
                              · {Math.floor(meta.callDuration / 60)}m {meta.callDuration % 60}s
                            </span>
                          )}
                        </div>
                      )}
                      {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                      <AttachmentList urls={attachmentUrls(m.meta)} out={out} />
                      {!m.body && isText && attachmentUrls(m.meta).length === 0 && (
                        <div className="italic opacity-70">(no content)</div>
                      )}
                      <div className={`mt-1 text-[10px] ${out ? "text-white/70" : "text-zinc-400"}`}>
                        {m.date_added ? fmtFull(m.date_added) : ""}
                        {out && m.status ? ` · ${m.status}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {active.conv.phone ? (
              <form
                action={sendInboxReply.bind(null, active.conv.id)}
                onSubmit={() => setTimeout(() => setFileNames([]), 800)}
                className="border-t border-zinc-100 p-4 dark:border-white/[0.05]"
              >
                {fileNames.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {fileNames.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand dark:text-brand-lighter"
                      >
                        <FontAwesomeIcon icon={faPaperclip} />
                        {name}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        if (fileRef.current) fileRef.current.value = "";
                        setFileNames([]);
                      }}
                      className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-600"
                    >
                      clear
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    name="files"
                    multiple
                    accept="image/*,.pdf,.vcf"
                    className="hidden"
                    onChange={(e) =>
                      setFileNames(Array.from(e.currentTarget.files ?? []).map((f) => f.name))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    title="Attach image or file (MMS)"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-black/[0.05] hover:text-brand dark:hover:bg-white/[0.08]"
                  >
                    <FontAwesomeIcon icon={faPaperclip} />
                  </button>
                  <textarea
                    name="body"
                    rows={2}
                    required={fileNames.length === 0}
                    placeholder={`Text ${title}…`}
                    className="input min-h-[3rem] flex-1 resize-y"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <SaveButton className="btn-primary px-5" savedLabel="Sent">
                    Send
                  </SaveButton>
                </div>
              </form>
            ) : (
              <div className="border-t border-zinc-100 px-4 py-3 text-center text-xs text-zinc-400 dark:border-white/[0.05]">
                No phone number — reply from HighLevel for this channel.
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ RIGHT: contact / event panel ============ */}
      <div className="card flex w-72 shrink-0 flex-col gap-0 overflow-y-auto">
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
