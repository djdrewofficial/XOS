"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Tabs from "@/components/Tabs";
import EntityPicker from "@/components/EntityPicker";
import VenueAutocomplete from "@/components/VenueAutocomplete";
import { buildScheduleRows } from "@/lib/paymentSchedule";
import { buildEventName } from "@/lib/eventName";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-white/15 dark:bg-zinc-900 dark:text-white";

type Opt = { id: string; name: string };
type Pkg = { id: string; name: string; default_price: number; deposit_value: number; allowed_splits: number[] | null };
type Addon = { id: string; name: string; default_price: number };
type Emp = { id: string; first_name: string; last_name: string };

export type NewEventFormProps = {
  action: (formData: FormData) => Promise<void>;
  roles: Opt[];
  eventTypes: Opt[];
  statuses: Opt[];
  inquirySources: Opt[];
  packages: Pkg[];
  addons: Addon[];
  employees: Emp[];
  customDateDefs: Opt[];
};

type ClientRow = {
  key: number;
  mode: "existing" | "new";
  client_id: string;
  label: string;
  first_name: string;
  last_name: string;
  email: string;
  cell_phone: string;
  role: string;
  is_primary: boolean;
};

let _k = 0;
const nextKey = () => ++_k;

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-zinc-500">{children}</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-bold text-zinc-900 dark:text-white">{children}</h2>;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-gradient-to-r from-brand to-brand-light px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create Event"}
    </button>
  );
}

/** Inline existing-client search (browser client, mirrors EntityPicker). */
function ClientSearch({ onPick }: { onPick: (c: { id: string; label: string }) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ id: string; first_name: string; last_name: string; email: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("clients")
        .select("id, first_name, last_name, email")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(8);
      setRes(data ?? []);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search existing clients…" className={inputCls} />
      {open && res.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-800">
          {res.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick({ id: c.id, label: `${c.first_name} ${c.last_name}`.trim() });
                setOpen(false);
                setQ("");
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-brand/5"
            >
              {c.first_name} {c.last_name} {c.email ? <span className="text-xs text-zinc-400">· {c.email}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewEventForm(props: NewEventFormProps) {
  // ---- Client tab ----
  const [clients, setClients] = useState<ClientRow[]>([
    { key: nextKey(), mode: "new", client_id: "", label: "", first_name: "", last_name: "", email: "", cell_phone: "", role: props.roles[0]?.name ?? "Contract Holder", is_primary: true },
  ]);
  const setClient = (key: number, patch: Partial<ClientRow>) =>
    setClients((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const setPrimary = (key: number) => setClients((cs) => cs.map((c) => ({ ...c, is_primary: c.key === key })));
  const addClient = () =>
    setClients((cs) => [
      ...cs,
      { key: nextKey(), mode: "new", client_id: "", label: "", first_name: "", last_name: "", email: "", cell_phone: "", role: props.roles[1]?.name ?? "Partner B", is_primary: false },
    ]);
  const removeClient = (key: number) => setClients((cs) => cs.filter((c) => c.key !== key));

  // ---- Details ----
  const [name, setName] = useState("");
  const [eventTypeId, setEventTypeId] = useState(
    props.eventTypes.find((t) => /wedding/i.test(t.name))?.id ?? props.eventTypes[0]?.id ?? ""
  );
  const [eventDate, setEventDate] = useState("");
  const typeName = props.eventTypes.find((t) => t.id === eventTypeId)?.name ?? null;
  const autoName = useMemo(
    () => buildEventName(clients.map((c) => ({ first_name: c.first_name || c.label.split(" ")[0], last_name: c.last_name, role: c.role, is_primary: c.is_primary })), typeName),
    [clients, typeName]
  );

  // ---- Booking ----
  const [statusId, setStatusId] = useState(props.statuses[0]?.id ?? "");
  const [sourceMode, setSourceMode] = useState<"existing" | "new">("existing");
  const [inquirySourceId, setInquirySourceId] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourcePersist, setNewSourcePersist] = useState(true);
  const [customDates, setCustomDates] = useState<Record<string, string>>({});

  // ---- Financial ----
  const [packageId, setPackageId] = useState("");
  const pkg = props.packages.find((p) => p.id === packageId) ?? null;
  const [priceOverride, setPriceOverride] = useState("");
  const [deposit, setDeposit] = useState("");
  const [travelFee, setTravelFee] = useState("");
  const [discounts, setDiscounts] = useState<{ label: string; amount: string }[]>([]);
  const [addonRows, setAddonRows] = useState<{ key: number; addon_id: string; quantity: number; price_override: string }[]>([]);
  const [scheduleCount, setScheduleCount] = useState(0);

  const pkgPrice = priceOverride !== "" ? Number(priceOverride) : pkg?.default_price ?? 0;
  const addonsTotal = addonRows.reduce((s, a) => {
    const cat = props.addons.find((x) => x.id === a.addon_id);
    const unit = a.price_override !== "" ? Number(a.price_override) : cat?.default_price ?? 0;
    return s + a.quantity * unit;
  }, 0);
  const discountTotal = discounts.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const estTotal = Math.max(0, pkgPrice + addonsTotal + (Number(travelFee) || 0) - discountTotal);
  const depositVal = deposit !== "" ? Number(deposit) : pkg?.deposit_value ?? 0;
  const splitOptions = pkg?.allowed_splits?.length ? pkg.allowed_splits : [1, 2, 3];
  const schedulePreview = useMemo(
    () =>
      scheduleCount > 0
        ? buildScheduleRows({
            total: estTotal,
            deposit: depositVal,
            eventDate: eventDate || null,
            terms: "days_before",
            termsDays: 30,
            plan: { kind: "split", count: scheduleCount },
            today: new Date().toISOString().slice(0, 10),
          })
        : [],
    [scheduleCount, estTotal, depositVal, eventDate]
  );

  // ---- Venue ----
  const [venueMode, setVenueMode] = useState<"existing" | "new" | "client_address">("existing");
  const [newVenue, setNewVenue] = useState<Record<string, unknown> | null>(null);
  const venueRef = useRef<HTMLDivElement>(null);

  // ---- Staff ----
  const [staffRows, setStaffRows] = useState<{ key: number; employee_id: string; role: string; flat_wage: string }[]>([]);

  // capture VenueAutocomplete hidden inputs into new_venue_json (it renders
  // hidden fields named venue_name/venue_address/... inside our container)
  function readNewVenue(): Record<string, unknown> | null {
    const root = venueRef.current;
    if (!root) return null;
    const g = (n: string) => (root.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value || null;
    const nm = g("venue_name");
    if (!nm) return null;
    return {
      name: nm,
      address: g("venue_address"),
      city: g("venue_city"),
      state: g("venue_state"),
      zip: g("venue_zip"),
      lat: g("venue_lat") ? Number(g("venue_lat")) : null,
      lng: g("venue_lng") ? Number(g("venue_lng")) : null,
      place_id: g("venue_place_id"),
    };
  }

  const clientsJson = JSON.stringify(
    clients.map((c) => ({
      mode: c.mode,
      client_id: c.mode === "existing" ? c.client_id : undefined,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      cell_phone: c.cell_phone,
      role: c.role,
      is_primary: c.is_primary,
    }))
  );
  const discountsJson = JSON.stringify(discounts.filter((d) => d.amount).map((d) => ({ label: d.label || "Discount", amount: Number(d.amount) || 0 })));
  const addonsJson = JSON.stringify(addonRows.filter((a) => a.addon_id).map((a) => ({ addon_id: a.addon_id, quantity: a.quantity, price_override: a.price_override !== "" ? Number(a.price_override) : null })));
  const staffJson = JSON.stringify(staffRows.filter((s) => s.employee_id).map((s) => ({ employee_id: s.employee_id, role: s.role || "DJ", flat_wage: Number(s.flat_wage) || 0 })));
  const customDatesJson = JSON.stringify(Object.entries(customDates).filter(([, v]) => v).map(([definition_id, value]) => ({ definition_id, value })));

  // ============ tab panels ============
  const clientTab = (
    <div className="space-y-4">
      <H>Who are we working with?</H>
      {clients.map((c) => (
        <div key={c.key} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.06]">
              {(["new", "existing"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setClient(c.key, { mode: m })}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${c.mode === m ? "bg-white text-brand shadow dark:bg-zinc-800 dark:text-brand-lighter" : "text-zinc-500"}`}
                >
                  {m === "new" ? "New client" : "Existing"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="radio" name="primary_radio" checked={c.is_primary} onChange={() => setPrimary(c.key)} className="size-4 accent-brand-light" />
                Primary
              </label>
              {clients.length > 1 && (
                <button type="button" onClick={() => removeClient(c.key)} className="text-xs text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>

          {c.mode === "existing" ? (
            c.client_id ? (
              <div className="flex items-center justify-between rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-white/15 dark:bg-white/[0.03]">
                <span className="font-semibold">{c.label}</span>
                <button type="button" onClick={() => setClient(c.key, { client_id: "", label: "" })} className="text-xs text-brand underline">
                  Change
                </button>
              </div>
            ) : (
              <ClientSearch onPick={(p) => setClient(c.key, { client_id: p.id, label: p.label })} />
            )
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><Label>First name</Label><input value={c.first_name} onChange={(e) => setClient(c.key, { first_name: e.target.value })} className={inputCls} /></label>
              <label className="block"><Label>Last name</Label><input value={c.last_name} onChange={(e) => setClient(c.key, { last_name: e.target.value })} className={inputCls} /></label>
              <label className="block"><Label>Email</Label><input value={c.email} onChange={(e) => setClient(c.key, { email: e.target.value })} className={inputCls} /></label>
              <label className="block"><Label>Cell</Label><input value={c.cell_phone} onChange={(e) => setClient(c.key, { cell_phone: e.target.value })} className={inputCls} /></label>
            </div>
          )}

          <div className="mt-3 max-w-xs">
            <Label>Role</Label>
            <select value={c.role} onChange={(e) => setClient(c.key, { role: e.target.value })} className={inputCls}>
              {props.roles.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <button type="button" onClick={addClient} className="rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-brand hover:text-brand dark:border-white/15 dark:text-zinc-300">
        + Add another client
      </button>
    </div>
  );

  const detailsTab = (
    <div className="space-y-4">
      <H>Event details</H>
      <Field label="Event name (leave blank to auto-name)">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName || "Event name"} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Event type">
          <select value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)} className={inputCls}>
            {props.eventTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </Field>
        <Field label="Event date"><input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Guest count"><input type="number" name="guest_count" className={inputCls} /></Field>
        <Field label="Setup time"><input type="time" name="setup_time" className={inputCls} /></Field>
        <Field label="Start time"><input type="time" name="start_time" className={inputCls} /></Field>
        <Field label="End time"><input type="time" name="end_time" className={inputCls} /></Field>
      </div>
    </div>
  );

  const bookingTab = (
    <div className="space-y-4">
      <H>Booking</H>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className={inputCls}>
            {props.statuses.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </Field>
        <div>
          <Label>Inquiry source</Label>
          <div className="flex gap-1 mb-1.5">
            {(["existing", "new"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setSourceMode(m)} className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sourceMode === m ? "bg-brand/10 text-brand dark:text-brand-lighter" : "text-zinc-500"}`}>
                {m === "existing" ? "Pick" : "Add new"}
              </button>
            ))}
          </div>
          {sourceMode === "existing" ? (
            <select value={inquirySourceId} onChange={(e) => setInquirySourceId(e.target.value)} className={inputCls}>
              <option value="">— Select —</option>
              {props.inquirySources.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          ) : (
            <div className="space-y-1.5">
              <input value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} placeholder="New source…" className={inputCls} />
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={newSourcePersist} onChange={(e) => setNewSourcePersist(e.target.checked)} className="size-4 accent-brand-light" />
                Save to my source list (uncheck for one-time)
              </label>
            </div>
          )}
        </div>
      </div>
      <Field label="Internal notes (staff only)"><textarea name="internal_notes" rows={2} className={inputCls} /></Field>
      <Field label="Contract notes (shown in the contract)"><textarea name="contract_notes" rows={2} className={inputCls} /></Field>
      {props.customDateDefs.length > 0 && (
        <div>
          <Label>Important dates</Label>
          <div className="grid grid-cols-2 gap-3">
            {props.customDateDefs.map((d) => (
              <label key={d.id} className="block">
                <span className="mb-1 block text-[11px] text-zinc-500">{d.name}</span>
                <input type="date" value={customDates[d.id] ?? ""} onChange={(e) => setCustomDates((m) => ({ ...m, [d.id]: e.target.value }))} className={inputCls} />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const financialTab = (
    <div className="space-y-4">
      <H>Financials</H>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Package">
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className={inputCls}>
            <option value="">— Select package —</option>
            {props.packages.map((p) => (<option key={p.id} value={p.id}>{p.name} — {money(p.default_price)}</option>))}
          </select>
        </Field>
        <Field label={`Package price${pkg ? ` (default ${money(pkg.default_price)})` : ""}`}>
          <input type="number" step="0.01" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} placeholder={pkg ? String(pkg.default_price) : "Select a package"} className={inputCls} />
        </Field>
        <Field label={`Deposit${pkg ? ` (default ${money(pkg.deposit_value)})` : ""}`}>
          <input type="number" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder={pkg ? String(pkg.deposit_value) : "0"} className={inputCls} />
        </Field>
        <Field label="Travel fee"><input type="number" step="0.01" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} className={inputCls} /></Field>
      </div>

      <div>
        <Label>Discounts</Label>
        <div className="space-y-2">
          {discounts.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input value={d.label} onChange={(e) => setDiscounts((ds) => ds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Label" className={inputCls} />
              <input type="number" step="0.01" value={d.amount} onChange={(e) => setDiscounts((ds) => ds.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" className="input w-32" />
              <button type="button" onClick={() => setDiscounts((ds) => ds.filter((_, j) => j !== i))} className="text-xs text-red-500">✕</button>
            </div>
          ))}
          {discounts.length < 2 && (
            <button type="button" onClick={() => setDiscounts((ds) => [...ds, { label: "", amount: "" }])} className="text-xs text-brand underline dark:text-brand-lighter">+ Add discount</button>
          )}
        </div>
      </div>

      <div>
        <Label>Add-ons</Label>
        <div className="space-y-2">
          {addonRows.map((a) => {
            const cat = props.addons.find((x) => x.id === a.addon_id);
            return (
              <div key={a.key} className="flex gap-2">
                <select value={a.addon_id} onChange={(e) => setAddonRows((rs) => rs.map((x) => (x.key === a.key ? { ...x, addon_id: e.target.value } : x)))} className={inputCls}>
                  <option value="">— Select add-on —</option>
                  {props.addons.map((x) => (<option key={x.id} value={x.id}>{x.name} — {money(x.default_price)}</option>))}
                </select>
                <input type="number" min={1} value={a.quantity} onChange={(e) => setAddonRows((rs) => rs.map((x) => (x.key === a.key ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} className="input w-16" />
                <input type="number" step="0.01" value={a.price_override} onChange={(e) => setAddonRows((rs) => rs.map((x) => (x.key === a.key ? { ...x, price_override: e.target.value } : x)))} placeholder={cat ? String(cat.default_price) : "Price"} className="input w-28" />
                <button type="button" onClick={() => setAddonRows((rs) => rs.filter((x) => x.key !== a.key))} className="text-xs text-red-500">✕</button>
              </div>
            );
          })}
          <button type="button" onClick={() => setAddonRows((rs) => [...rs, { key: nextKey(), addon_id: "", quantity: 1, price_override: "" }])} className="text-xs text-brand underline dark:text-brand-lighter">+ Add add-on</button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex justify-between"><span className="text-zinc-500">Estimated total</span><span className="font-bold">{money(estTotal)}</span></div>
      </div>

      <div>
        <Label>Payment schedule (optional)</Label>
        <select value={scheduleCount} onChange={(e) => setScheduleCount(Number(e.target.value))} className={`${inputCls} max-w-xs`}>
          <option value={0}>Don&apos;t set up yet</option>
          {splitOptions.map((n) => (<option key={n} value={n}>{n === 1 ? "Deposit + final payment" : `Deposit + ${n} payments`}</option>))}
        </select>
        {schedulePreview.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
                {schedulePreview.map((r) => (
                  <tr key={r.seq}><td className="px-3 py-1.5">{r.label}</td><td className="px-3 py-1.5 text-zinc-500">{r.due_date ?? "TBD"}</td><td className="px-3 py-1.5 text-right font-semibold">{money(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const venueTab = (
    <div className="space-y-4">
      <H>Venue</H>
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.06] max-w-md">
        {([["existing", "From our list"], ["new", "New (Google)"], ["client_address", "Use client address"]] as const).map(([m, lbl]) => (
          <button key={m} type="button" onClick={() => setVenueMode(m)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${venueMode === m ? "bg-white text-brand shadow dark:bg-zinc-800 dark:text-brand-lighter" : "text-zinc-500"}`}>{lbl}</button>
        ))}
      </div>

      {venueMode === "existing" && (
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Venue</Label><EntityPicker kind="venue" name="venue_id" /></div>
          <Field label="Room (if applicable)"><input name="venue_room_id_label" placeholder="Optional room name" className={inputCls} disabled /></Field>
        </div>
      )}
      {venueMode === "new" && (
        <div ref={venueRef}>
          <Label>Search Google for the venue</Label>
          <VenueAutocomplete defaultName="" defaultAddress="" />
          <p className="mt-1 text-[11px] text-zinc-400">Picking a result imports its address — we&apos;ll save it as a new venue.</p>
        </div>
      )}
      {venueMode === "client_address" && (
        <Field label="Client / event address">
          <input name="client_address" placeholder="123 Main St, City, FL" className={inputCls} />
          <p className="mt-1 text-[11px] text-zinc-400">Used as the event location — not saved to your venue list.</p>
        </Field>
      )}

      <Field label="Travel fee (optional)"><input type="number" step="0.01" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} className={`${inputCls} max-w-xs`} /></Field>
    </div>
  );

  const staffTab = (
    <div className="space-y-4">
      <H>Staff (optional — assign later if TBD)</H>
      <p className="text-sm text-zinc-500">Leave empty to assign DJs later. You can add staff anytime from the event page.</p>
      {staffRows.map((s) => (
        <div key={s.key} className="flex gap-2">
          <select value={s.employee_id} onChange={(e) => setStaffRows((rs) => rs.map((x) => (x.key === s.key ? { ...x, employee_id: e.target.value } : x)))} className={inputCls}>
            <option value="">— Employee —</option>
            {props.employees.map((emp) => (<option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>))}
          </select>
          <input value={s.role} onChange={(e) => setStaffRows((rs) => rs.map((x) => (x.key === s.key ? { ...x, role: e.target.value } : x)))} placeholder="Role" className="input w-40" />
          <input type="number" step="0.01" value={s.flat_wage} onChange={(e) => setStaffRows((rs) => rs.map((x) => (x.key === s.key ? { ...x, flat_wage: e.target.value } : x)))} placeholder="Wage" className="input w-28" />
          <button type="button" onClick={() => setStaffRows((rs) => rs.filter((x) => x.key !== s.key))} className="text-xs text-red-500">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setStaffRows((rs) => [...rs, { key: nextKey(), employee_id: "", role: "DJ", flat_wage: "" }])} className="text-xs text-brand underline dark:text-brand-lighter">+ Assign staff</button>
    </div>
  );

  return (
    <form
      action={(fd) => {
        // serialize dynamic state into the FormData the action reads
        fd.set("clients_json", clientsJson);
        fd.set("discounts_json", discountsJson);
        fd.set("addons_json", addonsJson);
        fd.set("staff_json", staffJson);
        fd.set("custom_dates_json", customDatesJson);
        fd.set("name", name);
        fd.set("event_type_id", eventTypeId);
        fd.set("event_date", eventDate);
        fd.set("status_id", statusId);
        fd.set("inquiry_source_id", sourceMode === "existing" ? inquirySourceId : "");
        fd.set("new_source_name", sourceMode === "new" ? newSourceName : "");
        fd.set("new_source_persist", newSourcePersist ? "true" : "false");
        fd.set("package_id", packageId);
        fd.set("package_price_override", priceOverride);
        fd.set("deposit_value", deposit);
        fd.set("travel_fee", travelFee);
        fd.set("schedule_count", String(scheduleCount));
        fd.set("use_client_address", venueMode === "client_address" ? "true" : "false");
        if (venueMode !== "existing") fd.delete("venue_id");
        fd.set("new_venue_json", venueMode === "new" ? JSON.stringify(readNewVenue()) : "null");
        return props.action(fd);
      }}
    >
      <Tabs
        tabs={[
          { id: "client", label: "Client Information", content: clientTab },
          { id: "details", label: "Details", content: detailsTab },
          { id: "booking", label: "Booking", content: bookingTab },
          { id: "financial", label: "Financial", content: financialTab },
          { id: "venue", label: "Venue", content: venueTab },
          { id: "staff", label: "Staff", content: staffTab },
        ]}
      />
      <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-white/10">
        <span className="text-xs text-zinc-400">{autoName && !name ? `Will be named "${autoName}"` : ""}</span>
        <Submit />
      </div>
    </form>
  );
}
