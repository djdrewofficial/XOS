"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faPenToSquare,
  faPhone,
  faEnvelope,
  faClock,
  faArrowRightArrowLeft,
  faCheck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { EventVendor } from "@/lib/planning";
import { saveEventVendor, removeEventVendor, searchVendors } from "@/app/portal/plan/[eventId]/actions";

const ROLES = [
  "Photographer", "Videographer", "Wedding Planner", "Day-of Coordinator", "Venue",
  "Caterer", "Florist", "Officiant", "Hair & Makeup", "Cake / Desserts",
  "Transportation", "Rentals", "Live Musician", "Other",
];

// A soft color per role so the roster reads at a glance (cinematic, not clinical).
function roleTone(role: string): string {
  const map: Record<string, string> = {
    Photographer: "from-rose-500/15 text-rose-600 dark:text-rose-300",
    Videographer: "from-rose-500/15 text-rose-600 dark:text-rose-300",
    "Wedding Planner": "from-brand/15 text-brand dark:text-brand-lighter",
    "Day-of Coordinator": "from-brand/15 text-brand dark:text-brand-lighter",
    Venue: "from-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    Caterer: "from-amber-500/15 text-amber-600 dark:text-amber-300",
    Florist: "from-pink-500/15 text-pink-600 dark:text-pink-300",
    Officiant: "from-sky-500/15 text-sky-600 dark:text-sky-300",
  };
  return map[role] ?? "from-zinc-500/15 text-zinc-600 dark:text-zinc-300";
}

export default function VendorTeamModule({
  eventId,
  vendors,
  canEdit,
}: {
  eventId: string;
  vendors: EventVendor[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null); // event_vendor id, or "new"

  return (
    <div>
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <FontAwesomeIcon icon={faArrowRightArrowLeft} /> Saved straight to your event — your DJ sees this instantly
      </div>

      {vendors.length === 0 && editing !== "new" && (
        <div className="mb-4 rounded-2xl border border-dashed border-zinc-300 p-8 text-center dark:border-white/10">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No vendors added yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {vendors.map((v) =>
          editing === v.id ? (
            <VendorForm key={v.id} eventId={eventId} vendor={v} onClose={() => setEditing(null)} />
          ) : (
            <VendorCard key={v.id} eventId={eventId} vendor={v} canEdit={canEdit} onEdit={() => setEditing(v.id)} />
          ),
        )}
      </div>

      {editing === "new" ? (
        <div className="mt-3">
          <VendorForm eventId={eventId} onClose={() => setEditing(null)} />
        </div>
      ) : (
        canEdit && (
          <button
            onClick={() => setEditing("new")}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 py-4 text-sm font-semibold text-zinc-500 transition hover:border-brand hover:text-brand dark:border-white/15 dark:text-zinc-400"
          >
            <FontAwesomeIcon icon={faPlus} /> Add a vendor
          </button>
        )
      )}
    </div>
  );
}

function VendorCard({
  eventId,
  vendor,
  canEdit,
  onEdit,
}: {
  eventId: string;
  vendor: EventVendor;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const [pending, start] = useTransition();
  const initial = vendor.company_name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 transition hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br to-transparent text-lg font-bold ${roleTone(vendor.role)}`}>
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <span className="mb-0.5 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-white/10">
            {vendor.role}
          </span>
          <p className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">{vendor.company_name}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
            {vendor.contact_name && <span>{vendor.contact_name}</span>}
            {vendor.contact_phone && <span><FontAwesomeIcon icon={faPhone} className="mr-1 text-xs" />{vendor.contact_phone}</span>}
            {vendor.contact_email && <span><FontAwesomeIcon icon={faEnvelope} className="mr-1 text-xs" />{vendor.contact_email}</span>}
            {vendor.arrival_time && <span className="text-brand dark:text-brand-lighter"><FontAwesomeIcon icon={faClock} className="mr-1 text-xs" />Arrives {vendor.arrival_time}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button onClick={onEdit} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-brand dark:hover:bg-white/5" title="Edit">
              <FontAwesomeIcon icon={faPenToSquare} />
            </button>
            <button
              onClick={() => { if (confirm("Remove this vendor?")) start(() => removeEventVendor(eventId, vendor.id)); }}
              disabled={pending}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              title="Remove"
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VendorForm({
  eventId,
  vendor,
  onClose,
}: {
  eventId: string;
  vendor?: EventVendor;
  onClose: () => void;
}) {
  const [role, setRole] = useState(vendor?.role ?? "Photographer");
  const [company, setCompany] = useState(vendor?.company_name ?? "");
  const [vendorId, setVendorId] = useState<string | null>(vendor?.vendor_id ?? null);
  const [contactName, setContactName] = useState(vendor?.contact_name ?? "");
  const [phone, setPhone] = useState(vendor?.contact_phone ?? "");
  const [email, setEmail] = useState(vendor?.contact_email ?? "");
  const [arrival, setArrival] = useState(vendor?.arrival_time ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Directory autocomplete
  const [suggests, setSuggests] = useState<{ id: string; company_name: string; category: string | null }[]>([]);
  const [showSug, setShowSug] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const term = company.trim();
    if (term.length < 1 || vendorId) {
      setSuggests([]);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const res = await searchVendors(eventId, term);
      if (id === reqId.current) setSuggests(res);
    }, 250);
    return () => clearTimeout(t);
  }, [company, vendorId, eventId]);

  function save() {
    setErr(null);
    start(async () => {
      const res = await saveEventVendor(eventId, {
        id: vendor?.id ?? null,
        vendorId,
        companyName: company,
        role,
        contactName,
        contactPhone: phone,
        contactEmail: email,
        arrivalTime: arrival,
      });
      if (res?.ok) onClose();
      else setErr(res?.error || "Could not save");
    });
  }

  return (
    <div className="rounded-2xl border-2 border-brand/40 bg-brand/[0.02] p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Role</label>
          <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="relative">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Company / vendor name</label>
          <input
            className="input w-full"
            placeholder="e.g. Evoke Photo & Film"
            value={company}
            onChange={(e) => { setCompany(e.target.value); setVendorId(null); }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
          />
          {showSug && suggests.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
              {suggests.map((s) => (
                <li key={s.id}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); setCompany(s.company_name); setVendorId(s.id); setShowSug(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    <span>{s.company_name}</span>
                    {s.category && <span className="text-xs text-zinc-400">{s.category}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {vendorId && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400"><FontAwesomeIcon icon={faCheck} className="mr-1" />Linked to your vendor directory</p>}
        </div>
        <input className="input w-full" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <input className="input w-full" placeholder="Arrival time (e.g. 3:00 pm)" value={arrival} onChange={(e) => setArrival(e.target.value)} />
        <input className="input w-full" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="input w-full" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      {err && <p className="mt-2 text-sm text-red-500">{err}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={save} disabled={pending || !company.trim()} className="btn-primary disabled:opacity-50">
          {pending ? "Saving…" : vendor ? "Save changes" : "Add vendor"}
        </button>
        <button onClick={onClose} className="btn-ghost"><FontAwesomeIcon icon={faXmark} className="mr-1.5" />Cancel</button>
      </div>
    </div>
  );
}
