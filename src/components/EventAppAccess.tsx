"use client";

import { useState, useTransition } from "react";
import { emailAppJoinCode, removeAppMember, resendAppInvite, revokeAppInvite } from "@/app/(app)/events/appAccessActions";

export type AppMemberCard = {
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  canRemove: boolean;
};

export type AppInviteCard = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: "pending" | "expired";
  expiresAt: string;
  invitedByName: string | null;
};

export default function EventAppAccess({
  eventId,
  needsSetup,
  loadError,
  members,
  invites,
}: {
  eventId: string;
  needsSetup: boolean;
  loadError: string | null;
  members: AppMemberCard[];
  invites: AppInviteCard[];
}) {
  if (needsSetup) {
    return (
      <div className="card p-6 text-sm text-zinc-600 dark:text-zinc-400 lg:col-span-2">
        <p className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">One-time setup needed</p>
        <p>
          Run migration{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
            supabase/migrations/00212_event_app_access.sql
          </code>{" "}
          in the Supabase SQL editor, then refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 lg:col-span-2">
      <h2 className="card-title">App access</h2>
      <p className="mb-4 text-sm text-zinc-500">
        People who can open this event in the couple&apos;s app, and invites that are still waiting. A partner has the same access as the couple. Guests invited from the planner stay guests.
      </p>
      {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}

      <h3 className="label-xs">Linked</h3>
      <ul className="mb-4 space-y-2">
        {members.length === 0 && <li className="text-sm text-zinc-400">Nobody with an app login is linked yet.</li>}
        {members.map((member) => (
          <MemberRow key={member.clientId} eventId={eventId} member={member} />
        ))}
      </ul>

      <h3 className="label-xs">Pending invites</h3>
      <ul className="mb-4 space-y-2">
        {invites.length === 0 && <li className="text-sm text-zinc-400">No invites waiting.</li>}
        {invites.map((invite) => (
          <InviteRow key={invite.id} eventId={eventId} invite={invite} />
        ))}
      </ul>

      <JoinCodeActions eventId={eventId} />
      <p className="mt-3 text-xs text-zinc-500">
        Removing someone takes them off the event. The join code still works until you reset it. The contract holder stays on the event.
      </p>
    </div>
  );
}

function MemberRow({ eventId, member }: { eventId: string; member: AppMemberCard }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const contact = [member.email, member.phone].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-white/10">
      <div className="min-w-0">
        <p className="font-medium text-zinc-800 dark:text-zinc-100">
          {member.name} <span className="text-xs font-semibold uppercase text-zinc-400">{member.role}</span>
        </p>
        {contact && <p className="truncate text-xs text-zinc-500">{contact}</p>}
      </div>
      {member.canRemove ? (
        <button
          type="button"
          disabled={pending}
          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await removeAppMember(eventId, member.clientId);
              if (!result.ok) setError(result.error ?? "Could not remove them.");
            })
          }
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      ) : (
        <span className="text-xs text-zinc-400">Stays on the event</span>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </li>
  );
}

function InviteRow({ eventId, invite }: { eventId: string; invite: AppInviteCard }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const contact = [invite.email, invite.phone].filter(Boolean).join(" · ");
  const when = new Date(invite.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-white/10">
      <div className="min-w-0">
        <p className="font-medium text-zinc-800 dark:text-zinc-100">
          {invite.name || contact || "Invite"}{" "}
          <span className="text-xs font-semibold uppercase text-zinc-400">{invite.role}</span>
          {invite.status === "expired" && <span className="ml-2 text-xs font-semibold text-amber-600">Expired</span>}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {contact}
          {invite.invitedByName ? ` · from ${invite.invitedByName}` : ""}
          {invite.status === "pending" ? ` · expires ${when}` : ` · expired ${when}`}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          className="text-xs font-semibold text-brand hover:underline disabled:opacity-50 dark:text-brand-lighter"
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await resendAppInvite(eventId, invite.id);
              if (!result.ok) setError(result.error ?? "Could not resend.");
            })
          }
        >
          {pending ? "Sending…" : "Resend"}
        </button>
        <button
          type="button"
          disabled={pending}
          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await revokeAppInvite(eventId, invite.id);
              if (!result.ok) setError(result.error ?? "Could not revoke.");
            })
          }
        >
          Revoke
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </li>
  );
}

function JoinCodeActions({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function send(reset: boolean) {
    setMsg(null);
    start(async () => {
      const result = await emailAppJoinCode(eventId, reset);
      setMsg(
        result.ok
          ? { ok: true, text: reset ? `New code emailed to ${result.emailed}` : `Code emailed to ${result.emailed}` }
          : { ok: false, text: result.error ?? "Could not send the email." },
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => send(false)} className="btn-primary disabled:opacity-50">
        {pending ? "Sending…" : "Email join code"}
      </button>
      <button type="button" disabled={pending} onClick={() => send(true)} className="btn-ghost disabled:opacity-50">
        Reset and email a new code
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
