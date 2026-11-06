"use client";

import { useState } from "react";
import type { MfaMethod } from "@/lib/mfaMethods";

export default function MfaMethodSwitch({
  methods,
  current,
  onPick,
}: {
  methods: { id: MfaMethod; label: string; detail?: string }[];
  current: MfaMethod;
  onPick: (id: MfaMethod) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = methods.filter((method) => method.id !== current);
  if (others.length === 0) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 w-full text-center text-sm font-semibold text-brand hover:underline dark:text-brand-lighter">
        Try another way
      </button>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Try another way</p>
      {others.map((method) => (
        <button
          key={method.id}
          type="button"
          onClick={() => {
            setOpen(false);
            onPick(method.id);
          }}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <span className="font-semibold text-zinc-800 dark:text-zinc-100">{method.label}</span>
          {method.detail ? <span className="mt-0.5 block text-xs text-zinc-500">{method.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}
