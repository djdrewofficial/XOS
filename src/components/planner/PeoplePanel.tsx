"use client";

import { useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserPlus,
  faCircleCheck,
  faClock,
  faPaperPlane,
  faTrash,
  faCrown,
} from "@fortawesome/free-solid-svg-icons";
import type { Person } from "@/lib/planning";
import { inviteGuest, resendGuestInvite, removeGuest } from "@/app/portal/plan/[eventId]/actions";

/* People tab — Hosts (the clients on the event) are read-only; Guests can be
   invited by hosts/staff to help answer the staff-flagged questions. */
export default function PeoplePanel({
  eventId,
  hosts,
  guests,
  canManage,
}: {
  eventId: string;
  hosts: Person[];
  guests: Person[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faCrown} /> Hosts
        </h3>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          The people on this event. Hosts can edit everything — music, timeline, and questions.
        </p>
        <ul className="space-y-2">
          {hosts.length === 0 && <li className="text-sm text-zinc-400">No hosts linked yet.</li>}
          {hosts.map((h) => (
            <PersonRow key={h.id} person={h} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand dark:text-brand-lighter">
          <FontAwesomeIcon icon={faUserPlus} /> Guests
        </h3>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Invite people to help fill out the questions you&apos;ve been asked — they only see those, nothing else.
        </p>

        <ul className="mb-4 space-y-2">
          {guests.length === 0 && <li className="text-sm text-zinc-400">No guests invited yet.</li>}
          {guests.map((g) => (
            <PersonRow key={g.id} person={g} eventId={eventId} canManage={canManage} />
          ))}
        </ul>

        {canManage && <InviteForm eventId={eventId} />}
      </section>
    </div>
  );
}

function PersonRow({
  person,
  eventId,
  canManage,
}: {
  person: Person;
  eventId?: string;
  canManage?: boolean;
}) {
  const [pending, start] = useTransition();
  const initials =
    person.name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <li className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-white/[0.06]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-sm font-bold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">{person.name}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {person.role}
          {person.email ? ` · ${person.email}` : ""}
        </p>
      </div>
      {person.hasAccount ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
          <FontAwesomeIcon icon={faCircleCheck} /> Active
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <FontAwesomeIcon icon={faClock} /> Invited
        </span>
      )}
      {person.kind === "guest" && canManage && eventId && (
        <>
          <button
            onClick={() => start(() => resendGuestInvite(eventId, person.id).then(() => undefined))}
            disabled={pending}
            className="text-zinc-400 hover:text-brand"
            title="Resend invite"
          >
            <FontAwesomeIcon icon={faPaperPlane} />
          </button>
          <button
            onClick={() => start(() => removeGuest(eventId, person.id))}
            disabled={pending}
            className="text-zinc-400 hover:text-red-500"
            title="Remove guest"
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </>
      )}
    </li>
  );
}

function InviteForm({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await inviteGuest(eventId, { firstName, lastName, email, relationship });
      if (res?.ok) {
        setMsg({ ok: true, text: "Invitation sent!" });
        setFirstName("");
        setLastName("");
        setEmail("");
        setRelationship("");
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res?.error || "Could not send invite" });
      }
    });
  }

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)} className="btn-primary">
          <FontAwesomeIcon icon={faUserPlus} className="mr-2" /> Invite a guest
        </button>
        {msg && (
          <p className={`mt-2 text-sm ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{msg.text}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/[0.08]">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <input className="input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        <input className="input sm:col-span-2" type="email" placeholder="Email (we'll send their invite here)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input sm:col-span-2" placeholder="Relationship (e.g. Maid of Honor, Planner)" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
      </div>
      {msg && !msg.ok && <p className="mt-2 text-sm text-red-500">{msg.text}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={pending || !email} className="btn-primary disabled:opacity-50">
          {pending ? "Sending…" : "Send invite"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}
