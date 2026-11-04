"use client";

import { useState } from "react";
import SaveButton from "@/components/SaveButton";
import BodyEditor from "@/components/BodyEditor";
import type { SocialLinks } from "@/components/RichTextEditor";
import type { ScheduledCommItem } from "@/lib/scheduledComms";
import {
  markScheduledCommSent,
  revertScheduledCommOverride,
  saveScheduledCommOverride,
  skipScheduledComm,
  undoSkipScheduledComm,
} from "@/app/(app)/events/[id]/scheduled-comms-actions";

const PILL: Record<ScheduledCommItem["state"], string> = {
  upcoming: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  due: "bg-brand/15 text-brand dark:text-brand-lighter",
  sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  marked_sent: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  not_sent: "bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400",
};

function Pill({ className, children }: { className: string; children: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}>{children}</span>;
}

function RowActions({ eventId, item }: { eventId: string; item: ScheduledCommItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.canSkip && (
        <form action={skipScheduledComm.bind(null, eventId, item.templateId, item.targetDate)}>
          <SaveButton className="btn-ghost px-3 py-1.5 text-xs" savedLabel="Skipped">
            Skip
          </SaveButton>
        </form>
      )}
      {item.canUndoSkip && (
        <form action={undoSkipScheduledComm.bind(null, eventId, item.templateId, item.targetDate)}>
          <SaveButton className="btn-ghost px-3 py-1.5 text-xs" savedLabel="Restored">
            Undo skip
          </SaveButton>
        </form>
      )}
      {item.canMarkSent && (
        <form
          action={markScheduledCommSent.bind(null, eventId, item.templateId, item.targetDate)}
          onSubmit={(e) => {
            if (!confirm("Mark this as already sent? The scheduler will not send it.")) e.preventDefault();
          }}
        >
          <SaveButton className="btn-ghost px-3 py-1.5 text-xs" savedLabel="Marked sent">
            Mark as sent
          </SaveButton>
        </form>
      )}
    </div>
  );
}

function EditPanel({ eventId, item, tagGroups, socialLinks, onClose }: {
  eventId: string;
  item: ScheduledCommItem;
  tagGroups: { group: string; tags: string[] }[];
  socialLinks: SocialLinks;
  onClose: () => void;
}) {
  return (
    <form
      action={saveScheduledCommOverride.bind(null, eventId, item.templateId, item.targetDate)}
      className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <p className="text-[11px] leading-relaxed text-zinc-500">
        This changes the {item.isSms ? "text" : "email"} for this event only. The shared template stays as it is.
        Merge tags such as the client&apos;s name and the event date still fill in when it sends.
      </p>
      {!item.isSms && (
        <label className="block">
          <span className="label-xs">Subject</span>
          <input name="subject" defaultValue={item.subject} className="input mt-1 w-full" />
        </label>
      )}
      <div>
        <span className="label-xs">Message</span>
        <div className="mt-1">
          <BodyEditor
            name="body_html"
            defaultValue={item.bodyHtml}
            defaultRaw={item.isRawHtml}
            tagGroups={tagGroups}
            socialLinks={socialLinks}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SaveButton className="btn-primary px-4 py-2 text-xs" savedLabel="Saved">
          Save for this event
        </SaveButton>
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">
          Close
        </button>
        {item.canRevert && (
          <button
            type="submit"
            formAction={revertScheduledCommOverride.bind(null, eventId, item.templateId, item.targetDate)}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-brand"
          >
            Revert to template
          </button>
        )}
      </div>
    </form>
  );
}

function CommRow({
  eventId,
  item,
  canEdit,
  editing,
  onEdit,
  tagGroups,
  socialLinks,
}: {
  eventId: string;
  item: ScheduledCommItem;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  tagGroups: { group: string; tags: string[] }[];
  socialLinks: SocialLinks;
}) {
  return (
    <li className="px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">{item.templateName}</span>
            <Pill className={item.channel === "sms" ? "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" : "bg-brand/10 text-brand dark:text-brand-lighter"}>
              {item.channel === "sms" ? "Text" : "Email"}
            </Pill>
            <Pill className={PILL[item.state]}>{item.stateLabel}</Pill>
            {item.edited && <Pill className="bg-brand/10 text-brand dark:text-brand-lighter">Edited</Pill>}
          </div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{item.whenLabel}</div>
          <div className="text-[11px] text-zinc-400">{item.ruleLabel}</div>
          <div className="mt-1 text-xs text-zinc-500">To: {item.recipientSummary}</div>
          {item.pauseNote && <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{item.pauseNote}</div>}
          {item.auditLines.map((line) => (
            <div key={line} className="text-[11px] text-zinc-400">{line}</div>
          ))}
        </div>
        {canEdit && (
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <RowActions eventId={eventId} item={item} />
            {item.canEdit && (
              <button type="button" onClick={onEdit} className="self-end text-xs font-semibold text-brand hover:underline dark:text-brand-lighter">
                {editing ? "Close editor" : item.edited ? "Edit again" : "Edit"}
              </button>
            )}
          </div>
        )}
      </div>
      {canEdit && editing && item.canEdit && (
        <EditPanel
          eventId={eventId}
          item={item}
          tagGroups={tagGroups}
          socialLinks={socialLinks}
          onClose={onEdit}
        />
      )}
    </li>
  );
}

export default function ScheduledComms({
  eventId,
  items,
  canEdit,
  commsPaused,
  tagGroups,
  socialLinks,
}: {
  eventId: string;
  items: ScheduledCommItem[];
  canEdit: boolean;
  commsPaused: boolean;
  tagGroups: { group: string; tags: string[] }[];
  socialLinks: SocialLinks;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const upcoming = items.filter((item) => item.section === "upcoming");
  const recent = items.filter((item) => item.section === "recent");

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-zinc-100 px-4 py-3 md:px-5 dark:border-white/[0.05]">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Scheduled communications</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
          Emails and texts this event is set to receive, from the active schedules. Skip one, edit the copy for this event only, or mark it as already sent so it doesn&apos;t go out again.
        </p>
      </div>
      {commsPaused && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 md:px-5 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Automated comms are paused for this event. Upcoming client messages stay on this list, and they will not go out until you resume.
        </div>
      )}
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-zinc-400">
          No scheduled email or text matches this event in the last 90 days or coming up. A template has to be active and fit this event&apos;s date, status, and type.
        </div>
      ) : (
        <div>
          {upcoming.length > 0 && (
            <div>
              <div className="bg-zinc-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 md:px-5 dark:bg-white/[0.03]">
                Upcoming
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
                {upcoming.map((item) => (
                  <CommRow
                    key={item.key}
                    eventId={eventId}
                    item={item}
                    canEdit={canEdit}
                    editing={editingKey === item.key}
                    onEdit={() => setEditingKey((key) => (key === item.key ? null : item.key))}
                    tagGroups={tagGroups}
                    socialLinks={socialLinks}
                  />
                ))}
              </ul>
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="bg-zinc-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 md:px-5 dark:bg-white/[0.03]">
                Recent
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
                {recent.map((item) => (
                  <CommRow
                    key={item.key}
                    eventId={eventId}
                    item={item}
                    canEdit={canEdit}
                    editing={editingKey === item.key}
                    onEdit={() => setEditingKey((key) => (key === item.key ? null : item.key))}
                    tagGroups={tagGroups}
                    socialLinks={socialLinks}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
