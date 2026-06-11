"use client";

import { useState } from "react";

/* ============ Button Settings (DJEP General tab) ============
   Owns button title + colors + font so the Preview updates live. */

const FONT_WEIGHTS = [
  [100, "100 - Thin"],
  [200, "200 - Extra Light"],
  [300, "300 - Light"],
  [400, "400 - Normal"],
  [500, "500 - Medium"],
  [600, "600 - Semi Bold"],
  [700, "700 - Bold"],
  [800, "800 - Extra Bold"],
  [900, "900 - Ultra Bold"],
] as const;

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24] as const;

function normalizeHex(v: string) {
  const s = v.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
  return s;
}

function HexColorField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  return (
    <div className="flex items-center">
      <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-2.5 text-sm text-zinc-500 dark:border-white/10 dark:bg-white/[0.06]">
        #
      </span>
      <input
        value={hex}
        onChange={(e) => onChange(`#${normalizeHex(e.target.value)}`)}
        className="h-9 w-full min-w-0 border border-zinc-300 bg-white px-2 text-sm uppercase text-zinc-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100"
        spellCheck={false}
      />
      <input
        type="color"
        value={`#${(hex + "000000").slice(0, 6)}`}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 cursor-pointer rounded-r-lg border border-l-0 border-zinc-300 bg-white p-1 dark:border-white/10 dark:bg-white/[0.04]"
        aria-label="Pick color"
      />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

export function ButtonSettingsRows({
  d,
}: {
  d: {
    button_text?: string;
    button_bg?: string;
    button_fg?: string;
    button_font_size?: number;
    button_font_weight?: number;
  };
}) {
  const [text, setText] = useState(d.button_text ?? "");
  const [bg, setBg] = useState(d.button_bg ?? "#97CC9A");
  const [fg, setFg] = useState(d.button_fg ?? "#000000");
  const [size, setSize] = useState(d.button_font_size ?? 16);
  const [weight, setWeight] = useState(d.button_font_weight ?? 900);

  return (
    <>
      <div className="grid gap-2 px-4 py-3.5 md:grid-cols-[260px_1fr] md:items-center">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Button Title</div>
        <input
          name="button_text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input w-full"
        />
      </div>
      <div className="grid gap-2 px-4 py-3.5 md:grid-cols-[260px_1fr] md:items-center">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Preview</div>
        <div>
          <span
            className="inline-block rounded px-4 py-2 shadow-sm"
            style={{
              backgroundColor: bg,
              color: fg,
              fontSize: `${size}px`,
              fontWeight: weight,
            }}
          >
            {text || "Button"}
          </span>
        </div>
      </div>
      <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-1.5 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Background Color
          </div>
          <HexColorField name="button_bg" value={bg} onChange={setBg} />
        </div>
        <div>
          <div className="mb-1.5 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Text Color
          </div>
          <HexColorField name="button_fg" value={fg} onChange={setFg} />
        </div>
        <div>
          <div className="mb-1.5 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Font Size
          </div>
          <select
            name="button_font_size"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="input w-full"
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1.5 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Font Weight
          </div>
          <select
            name="button_font_weight"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="input w-full"
          >
            {FONT_WEIGHTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

/* ============ "All / Only These" radio + scrollable checklist ============ */

export function RadioChecklist({
  name,
  items,
  selected,
  allLabel,
  onlyLabel,
}: {
  name: string;
  items: { id: string; name: string; color?: string; text_color?: string }[];
  selected: string[];
  allLabel: string;
  onlyLabel: string;
}) {
  const [mode, setMode] = useState<"all" | "only">(selected.length > 0 ? "only" : "all");
  const [checked, setChecked] = useState<Set<string>>(new Set(selected));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pill = (active: boolean) =>
    `flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
      active
        ? "border-brand bg-brand/5 font-semibold text-brand dark:border-brand-light dark:text-brand-lighter"
        : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-white/10 dark:text-zinc-400"
    }`;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <label className={pill(mode === "all")}>
          <input
            type="radio"
            checked={mode === "all"}
            onChange={() => setMode("all")}
            className="accent-brand-light"
          />
          {allLabel}
        </label>
        <label className={pill(mode === "only")}>
          <input
            type="radio"
            checked={mode === "only"}
            onChange={() => setMode("only")}
            className="accent-brand-light"
          />
          {onlyLabel}
        </label>
      </div>

      {mode === "only" && (
        <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 p-2.5 dark:border-white/10">
          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setChecked(new Set(items.map((i) => i.id)))}
              className="rounded bg-brand px-2 py-0.5 text-[11px] font-semibold text-white hover:brightness-110"
            >
              select all
            </button>
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="rounded bg-zinc-400 px-2 py-0.5 text-[11px] font-semibold text-white hover:brightness-110 dark:bg-zinc-600"
            >
              select none
            </button>
          </div>
          <div className="space-y-1">
            {items.map((it) => (
              <label key={it.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  value={it.id}
                  checked={checked.has(it.id)}
                  onChange={() => toggle(it.id)}
                  className="size-4 accent-brand-light"
                />
                {it.color ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: it.color, color: it.text_color }}
                  >
                    {it.name}
                  </span>
                ) : (
                  <span className="text-zinc-700 dark:text-zinc-300">{it.name}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ Enabled / Disabled toggle (DJEP Automation tab) ============ */

export function EnabledToggle({
  name,
  defaultChecked,
}: {
  name: string;
  defaultChecked: boolean;
}) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setOn(true)}
        className={`flex items-center gap-2 rounded-lg border px-5 py-2 text-sm font-semibold transition-colors ${
          on
            ? "border-green-600 bg-green-100 text-green-800 dark:border-green-500 dark:bg-green-500/15 dark:text-green-400"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-white/10 dark:text-zinc-400"
        }`}
      >
        <span className={`size-3 rounded-full border-2 ${on ? "border-green-700 bg-green-600" : "border-zinc-400"}`} />
        Enabled
      </button>
      <button
        type="button"
        onClick={() => setOn(false)}
        className={`flex items-center gap-2 rounded-lg border px-5 py-2 text-sm font-semibold transition-colors ${
          !on
            ? "border-red-500 bg-red-100 text-red-700 dark:border-red-500 dark:bg-red-500/15 dark:text-red-400"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-white/10 dark:text-zinc-400"
        }`}
      >
        <span className={`size-3 rounded-full border-2 ${!on ? "border-red-600 bg-red-500" : "border-zinc-400"}`} />
        Disabled
      </button>
      {on && <input type="hidden" name={name} value="on" />}
    </div>
  );
}
