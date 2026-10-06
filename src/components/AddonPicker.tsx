"use client";

import { useRef, useState, useTransition } from "react";

type Addon = { id: string; name: string; default_price: number };

/* Add-on picker for the event Financials tab. Manages its own pending state
   (not SaveButton) so it's immediately ready for the next add — the shared
   button's "✓ Added" pulse left people refreshing to add another. */
export default function AddonPicker({
  catalog,
  action,
}: {
  catalog: Addon[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [price, setPrice] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const name = catalog.find((a) => a.id === fd.get("addon_id"))?.name ?? "Add-on";
        setError(null);
        startTransition(async () => {
          try {
            await action(fd);
            formRef.current?.reset();
            setPrice("");
            setFlash(`✓ ${name} added`);
            setTimeout(() => setFlash(null), 2500);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't add that add-on.");
          }
        });
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="min-w-44 flex-1">
        <select
          name="addon_id"
          required
          className="input w-full"
          onChange={(e) => {
            const addon = catalog.find((a) => a.id === e.target.value);
            setPrice(addon ? String(addon.default_price) : "");
          }}
        >
          <option value="">Select add-on…</option>
          {catalog.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — ${Number(a.default_price).toFixed(2)}
            </option>
          ))}
        </select>
      </div>
      <input type="number" name="quantity" defaultValue={1} min={1} className="input w-16" title="Quantity" />
      <input
        type="number"
        step="0.01"
        name="price_override"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Price"
        className="input w-28"
        title="Price for this event — edit to override"
      />
      <button disabled={pending} className="btn-primary gap-2 px-4 py-2 text-xs disabled:cursor-wait">
        {pending && (
          <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {pending ? "Adding…" : "Add"}
      </button>
      {flash && <span className="w-full text-xs font-semibold text-green-600 dark:text-green-400">{flash}</span>}
      {error && <span className="w-full text-xs text-red-600 dark:text-red-400">{error}</span>}
    </form>
  );
}
