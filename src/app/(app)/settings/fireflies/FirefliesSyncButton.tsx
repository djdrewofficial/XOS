"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFirefliesNow } from "./actions";

export default function FirefliesSyncButton() {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => {
          setBusy(true);
          setMsg(null);
          start(async () => {
            const res = await syncFirefliesNow();
            setMsg(res.error ? res.error : `Imported ${res.imported} recent meeting${res.imported === 1 ? "" : "s"}.`);
            setBusy(false);
            router.refresh();
          });
        }}
        disabled={busy}
        className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync recent meetings"}
      </button>
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
