"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Match = { id: string; first_name: string; last_name: string; email: string | null; cell_phone: string | null };

const ROLES = ["Contract Holder", "Bride", "Groom", "Quinceañera", "Mother of the Bride", "Father of the Bride", "Planner", "Client"];

export default function ClientPicker({
  attachExisting,
  createAndAttach,
}: {
  attachExisting: (formData: FormData) => Promise<void>;
  createAndAttach: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Match | null>(null);
  const [creating, setCreating] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() || selected || creating) {
      setMatches([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const q = query.trim().replace(/[%,]/g, "");
      const { data } = await supabase
        .from("clients")
        .select("id, first_name, last_name, email, cell_phone")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
        .order("first_name")
        .limit(8);
      setMatches((data as Match[]) ?? []);
      setSearching(false);
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, selected, creating]);

  const parts = query.trim().split(/\s+/);
  const guessFirst = parts[0] ?? "";
  const guessLast = parts.slice(1).join(" ");

  const reset = () => {
    setQuery("");
    setSelected(null);
    setCreating(false);
    setMatches([]);
  };

  return (
    <div>
      {!selected && !creating && (
        <>
          <label className="label-xs">Search Clients — Or Type A New Name</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing a name…"
            className="input w-full"
            autoComplete="off"
          />
          {query.trim() && (
            <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95">
              {/* create-new is the DEFAULT first option */}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-brand/50"
              >
                <span className="rounded bg-gradient-to-r from-brand to-brand-light px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  New
                </span>
                Create new client &quot;{query.trim()}&quot;
              </button>
              {searching && <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>}
              {!searching &&
                matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.07]"
                  >
                    <span className="font-medium text-zinc-200">
                      {m.first_name} {m.last_name}
                    </span>
                    <span className="text-xs text-zinc-500">{m.email ?? m.cell_phone ?? ""}</span>
                  </button>
                ))}
              {!searching && matches.length === 0 && (
                <div className="px-3 py-2 text-xs text-zinc-600">No existing clients match.</div>
              )}
            </div>
          )}
        </>
      )}

      {/* attach an existing client */}
      {selected && (
        <form action={attachExisting} className="space-y-3">
          <input type="hidden" name="client_id" value={selected.id} />
          <div className="flex items-center justify-between rounded-lg border border-brand-light/40 bg-brand/30 px-3 py-2">
            <span className="text-sm font-semibold text-white">
              {selected.first_name} {selected.last_name}
              <span className="ml-2 text-xs font-normal text-zinc-400">{selected.email ?? selected.cell_phone ?? ""}</span>
            </span>
            <button type="button" onClick={reset} className="text-xs text-zinc-400 hover:text-white">
              change
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label-xs">Role On This Event</label>
              <input name="role" defaultValue="Client" list="picker-roles" className="input w-full" />
            </div>
            <button className="btn-primary">Add To Event</button>
          </div>
        </form>
      )}

      {/* create a brand-new client */}
      {creating && (
        <form
          action={async (fd) => {
            await createAndAttach(fd);
            reset();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-xs">First Name</label>
              <input name="first_name" defaultValue={guessFirst} required className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Last Name</label>
              <input name="last_name" defaultValue={guessLast} className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Cell Phone</label>
              <input name="cell_phone" className="input w-full" />
            </div>
            <div>
              <label className="label-xs">Email</label>
              <input type="email" name="email" className="input w-full" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label-xs">Role On This Event</label>
              <input name="role" defaultValue="Contract Holder" list="picker-roles" className="input w-full" />
            </div>
            <button className="btn-primary">Create &amp; Add</button>
            <button type="button" onClick={reset} className="btn-ghost px-4 py-2.5 text-xs">
              Cancel
            </button>
          </div>
        </form>
      )}

      <datalist id="picker-roles">
        {ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </div>
  );
}
