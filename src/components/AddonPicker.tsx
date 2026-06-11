"use client";

import { useRef, useState } from "react";

type Addon = { id: string; name: string; default_price: number };

export default function AddonPicker({
  catalog,
  action,
}: {
  catalog: Addon[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [price, setPrice] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await action(fd);
        formRef.current?.reset();
        setPrice("");
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
      <button className="btn-primary px-4 py-2 text-xs">Add</button>
    </form>
  );
}
