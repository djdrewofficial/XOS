"use client";

import { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperclip, faFile } from "@fortawesome/free-solid-svg-icons";
import SaveButton from "@/components/SaveButton";
import { channelIcon, channelLabel, channelColor, fmtFull } from "@/app/(app)/inbox/ui";
import { sendInboxReply } from "@/app/(app)/inbox/actions";

/* Shared pieces for anywhere a HighLevel thread renders (inbox, event Comms
   tab) — bubbles, attachments, and the SMS/MMS reply form. */

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

const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic)(\?|$)/i;

/** GHL stores attachments as URL strings (ours and theirs both end up on their CDN). */
export function attachmentUrls(meta: Record<string, unknown> | null): string[] {
  const raw = (meta as { attachments?: unknown })?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === "string" ? a : (a as { url?: string })?.url ?? ""))
    .filter(Boolean);
}

export function AttachmentList({ urls, out }: { urls: string[]; out: boolean }) {
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

export function MessageBubble({ m }: { m: MsgRow }) {
  const out = m.direction === "outbound";
  const isText = m.message_type === "TYPE_SMS" || m.message_type === "TYPE_WHATSAPP";
  const meta = (m.meta ?? {}) as { callDuration?: number };
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
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
        {m.message_type === "TYPE_EMAIL" && (m.meta as { subject?: string } | null)?.subject && (
          <div className="mb-1 text-[12px] font-bold">
            {(m.meta as { subject?: string }).subject}
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
}

export type ThreadDoc = { id: string; title: string };

const CHANNEL_LABELS: Record<string, string> = {
  SMS: "Text (SMS)",
  Email: "Email",
  WhatsApp: "WhatsApp",
  IG: "Instagram DM",
  FB: "Facebook Messenger",
  GMB: "Google Business",
};

const TYPE_TO_CHANNEL: Record<string, string> = {
  TYPE_SMS: "SMS",
  TYPE_EMAIL: "Email",
  TYPE_WHATSAPP: "WhatsApp",
  TYPE_INSTAGRAM: "IG",
  TYPE_FACEBOOK: "FB",
  TYPE_GMB: "GMB",
};

export const CHANNEL_TO_TYPE: Record<string, string> = {
  SMS: "TYPE_SMS",
  Email: "TYPE_EMAIL",
  WhatsApp: "TYPE_WHATSAPP",
  IG: "TYPE_INSTAGRAM",
  FB: "TYPE_FACEBOOK",
  GMB: "TYPE_GMB",
};

/** Channels this conversation can actually be replied on: SMS needs a phone,
    Email needs an address, social channels need an existing thread there. */
export function availableChannels(
  conversation: { phone: string | null; email: string | null },
  messages: MsgRow[]
): string[] {
  const channels: string[] = [];
  if (conversation.phone) channels.push("SMS");
  if (conversation.email || messages.some((m) => m.message_type === "TYPE_EMAIL")) channels.push("Email");
  for (const [type, ch] of [["TYPE_WHATSAPP", "WhatsApp"], ["TYPE_INSTAGRAM", "IG"], ["TYPE_FACEBOOK", "FB"], ["TYPE_GMB", "GMB"]] as const) {
    if (messages.some((m) => m.message_type === type)) channels.push(ch);
  }
  return channels.length ? channels : ["SMS"];
}

/** App-icon tabs above a thread: All + one branded icon per channel the
    conversation supports. Selecting one filters the view AND sets where the
    reply goes. One thread per person — the icons flip between channels. */
export function ChannelTabs({
  conversation,
  messages,
  value,
  onChange,
}: {
  conversation: { phone: string | null; email: string | null };
  messages: MsgRow[];
  value: string; // "all" or a channel key
  onChange: (v: string) => void;
}) {
  const channels = availableChannels(conversation, messages);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
          value === "all"
            ? "bg-gradient-to-r from-brand to-brand-light text-white"
            : "text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
        }`}
      >
        All
      </button>
      {channels.map((c) => {
        const type = CHANNEL_TO_TYPE[c];
        const active = value === c;
        const accent = channelColor(type);
        return (
          <button
            key={c}
            type="button"
            title={CHANNEL_LABELS[c] ?? c}
            onClick={() => onChange(c)}
            className={`flex size-8 items-center justify-center rounded-full text-sm transition-all ${
              active
                ? "bg-black/[0.06] ring-2 ring-brand dark:bg-white/[0.1]"
                : "text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            }`}
            style={active && accent ? { color: accent } : accent ? { color: `${accent}99` } : undefined}
          >
            <FontAwesomeIcon icon={channelIcon(type)} />
          </button>
        );
      })}
    </div>
  );
}

/** Omnichannel composer — replies on the active channel (set by the icon
    tabs, or auto = wherever the client last messaged from). Email gets a
    subject line and can attach XOS documents as branded PDFs. */
export function ReplyForm({
  conversation,
  messages,
  title,
  docs = [],
  forcedChannel = null,
  onOptimistic,
}: {
  conversation: { id: string; phone: string | null; email: string | null };
  messages: MsgRow[];
  title: string;
  docs?: ThreadDoc[];
  forcedChannel?: string | null;
  onOptimistic?: (body: string, channel: string) => void;
}) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const channels = availableChannels(conversation, messages);
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const autoChannel =
    (lastInbound?.message_type && TYPE_TO_CHANNEL[lastInbound.message_type]) || channels[0];
  const channel =
    forcedChannel && channels.includes(forcedChannel)
      ? forcedChannel
      : channels.includes(autoChannel)
        ? autoChannel
        : channels[0];
  const accent = channelColor(CHANNEL_TO_TYPE[channel]);

  return (
    <form
      action={sendInboxReply.bind(null, conversation.id)}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const ta = form.elements.namedItem("body") as HTMLTextAreaElement | null;
        const body = ta?.value?.trim() ?? "";
        // optimistic bubble (text-only sends; file sends fall back to realtime)
        if (body && fileNames.length === 0) onOptimistic?.(body, channel);
        setTimeout(() => { setFileNames([]); if (ta) ta.value = ""; }, 0);
      }}
      className="border-t border-zinc-100 p-4 dark:border-white/[0.05]"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="channel" value={channel} />
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold dark:bg-white/[0.08]"
          style={accent ? { color: accent } : undefined}
          title="Replies go to this channel — switch with the icons above"
        >
          <FontAwesomeIcon icon={channelIcon(CHANNEL_TO_TYPE[channel])} />
          via {CHANNEL_LABELS[channel] ?? channel}
        </span>
        {channel === "Email" && (
          <input
            name="subject"
            placeholder="Subject…"
            className="input min-w-44 flex-1 py-1 text-xs"
          />
        )}
        {docs.length > 0 && (
          <select name="attach_document_id" defaultValue="" className="input w-auto max-w-56 py-1 text-xs" title="Attach a document (sent as branded PDF)">
            <option value="">No document</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>📎 {d.title}</option>
            ))}
          </select>
        )}
      </div>
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
          placeholder={`${channel === "Email" ? "Email" : "Message"} ${title}…`}
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
  );
}
