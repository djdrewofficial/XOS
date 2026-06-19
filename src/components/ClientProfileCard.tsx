"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faPhone, faLocationDot, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { faInstagram, faTiktok } from "@fortawesome/free-brands-svg-icons";
import ClientForm from "@/components/ClientForm";
import type { Client } from "@/lib/types";

const handle = (h: string | null) => (h ? h.replace(/^@+/, "") : "");

export default function ClientProfileCard({
  client,
  action,
}: {
  client: Client;
  action: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="card-title">Edit Client</h2>
          <button onClick={() => setEditing(false)} className="text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            Cancel
          </button>
        </div>
        <ClientForm client={client} action={action} />
      </div>
    );
  }

  const initials = `${client.first_name?.[0] ?? ""}${client.last_name?.[0] ?? ""}`.toUpperCase() || "?";
  const ig = handle(client.instagram);
  const tt = handle(client.tiktok);
  const chip =
    "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-black/[0.02] px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]";

  return (
    <div className="card p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-light text-lg font-bold text-white">
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">
                {client.first_name} {client.last_name}
              </h1>
              {client.organization && <p className="text-sm text-zinc-500">{client.organization}</p>}
            </div>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
            >
              <FontAwesomeIcon icon={faPenToSquare} /> Edit
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {client.email && (
              <a href={`mailto:${client.email}`} className={chip}>
                <FontAwesomeIcon icon={faEnvelope} className="text-zinc-400" /> {client.email}
              </a>
            )}
            {client.cell_phone && (
              <a href={`tel:${client.cell_phone.replace(/[^\d+]/g, "")}`} className={chip}>
                <FontAwesomeIcon icon={faPhone} className="text-zinc-400" /> {client.cell_phone}
              </a>
            )}
            {ig && (
              <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" className={chip}>
                <FontAwesomeIcon icon={faInstagram} className="text-[#E1306C]" /> @{ig}
              </a>
            )}
            {tt && (
              <a href={`https://tiktok.com/@${tt}`} target="_blank" rel="noreferrer" className={chip}>
                <FontAwesomeIcon icon={faTiktok} /> @{tt}
              </a>
            )}
          </div>

          {client.mailing_address && (
            <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <FontAwesomeIcon icon={faLocationDot} className="text-zinc-400" /> {client.mailing_address}
            </p>
          )}

          {client.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-black/[0.02] p-3 text-sm text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-300">
              {client.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
