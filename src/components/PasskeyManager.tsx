"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removePasskey, renamePasskey } from "@/app/(app)/account/passkeyActions";
import { registerPasskey } from "@/lib/passkeyBrowser";
import type { PasskeySummary } from "@/lib/passkey";

export default function PasskeyManager({
  ready,
  passkeys,
}: {
  ready: boolean;
  passkeys: PasskeySummary[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    const result = await registerPasskey(name);
    setBusy(false);
    if (!result.ok) {
      if (!result.cancelled) setError(result.error);
      return;
    }
    setName("");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <p className="mb-1 font-semibold">One-time setup needed</p>
        <p>
          Run migration{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">supabase/migrations/00210_staff_passkeys.sql</code>{" "}
          in the Supabase SQL editor, then refresh. Authenticator, text, and email codes still work.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A passkey signs you in with Face ID, Touch ID, a device PIN, or a passkey saved in 1Password or iCloud
        Keychain. That sign-in is complete on its own. Password and a verification code still work too.
      </p>
      {passkeys.length === 0 ? (
        <p className="text-sm text-zinc-500">No passkeys yet.</p>
      ) : (
        <ul className="space-y-3">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
              <PasskeyRow
                passkey={passkey}
                onError={setError}
                onChanged={() => router.refresh()}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-white/[0.08]">
        <label className="label-xs" htmlFor="passkey-name">
          Name for a new passkey
        </label>
        <input
          id="passkey-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-full max-w-xs"
          placeholder="Drew's iPhone"
          maxLength={80}
        />
        <button type="button" onClick={add} disabled={busy} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {busy ? "Waiting for the passkey…" : "Add a passkey"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function PasskeyRow({
  passkey,
  onChanged,
  onError,
}: {
  passkey: PasskeySummary;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name);
  const [busy, setBusy] = useState(false);

  async function save() {
    onError(null);
    setBusy(true);
    const result = await renamePasskey(passkey.id, name);
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    onError(null);
    setBusy(true);
    const result = await removePasskey(passkey.id);
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input max-w-xs" maxLength={80} />
          <button type="button" onClick={save} disabled={busy || !name.trim()} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? "Saving…" : "Save name"}
          </button>
          <button
            type="button"
            onClick={() => {
              setName(passkey.name);
              setEditing(false);
            }}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{passkey.name}</p>
            <p className="text-xs text-zinc-500">
              {passkey.backedUp ? "Synced" : "This device"} · Added {formatWhen(passkey.createdAt)} · Last used{" "}
              {passkey.lastUsedAt ? formatWhen(passkey.lastUsedAt) : "not yet"}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="btn-ghost px-3 py-1.5 text-xs">
              Rename
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="btn-ghost px-3 py-1.5 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
            >
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}
