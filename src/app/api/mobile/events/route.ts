import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { getMobileMe } from "@/lib/auth";
import { parseSchedulePlan } from "@/lib/paymentSchedule";
import { createEventCore, type EventCreateInput, type NewClient } from "@/lib/eventCreate";

/* POST /api/mobile/events — XOS Mobile "Add Event". Runs the exact create path
   the web onboarding form uses (createEventCore in lib/eventCreate, shared with
   the createEventOnboarding server action), so a phone-made event gets the same
   package date/weekday pricing, default add-ons + equipment, deposit default,
   schedule rows and "event created" automations.

   Auth: Bearer Supabase JWT (route is middleware-exempt under /api/mobile/),
   events = edit, office tiers only (field staff can't create events).

   Body:
   { clients:[{mode:'new'|'existing', client_id?, first_name, last_name, email, cell_phone, role, is_primary, is_contract_holder}],
     event:{name?, event_type_id, event_date?, guest_count?, setup_time?, start_time?, end_time?, status_id,
            inquiry_source_id?, new_inquiry_source?:{name, persist}, internal_notes?, contract_notes?,
            custom_dates?:{[definition_id]:'YYYY-MM-DD'}},
     financial:{package_id?, package_price_override?, deposit_value?, travel_fee?, discounts?:[{label,amount}] (max 2),
                addons?:[{addon_id, quantity, price_override?}], schedule_plan:''|'full'|'split:N'},
     venue:{mode:'list', venue_id, venue_room_id?} | {mode:'google', place:{name,address,city,state,zip,lat,lng,google_place_id}}
          | {mode:'manual', name, address} | {mode:'client_address', address},
     staff?:[{employee_id, role?, flat_wage?}] }
   → 200 {id} | 400 {error} | 401 {error} | 403 {error} */

export const dynamic = "force-dynamic";

class BadRequest extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function str(v: unknown, field: string, max = 2000): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new BadRequest(`${field} must be a string.`);
  const s = v.trim();
  if (s.length > max) throw new BadRequest(`${field} is too long.`);
  return s === "" ? null : s;
}
function uuid(v: unknown, field: string, required = false): string | null {
  const s = str(v, field, 64);
  if (!s) {
    if (required) throw new BadRequest(`${field} is required.`);
    return null;
  }
  if (!UUID.test(s)) throw new BadRequest(`${field} must be an id.`);
  return s;
}
function date(v: unknown, field: string): string | null {
  const s = str(v, field, 10);
  if (s && !DATE.test(s)) throw new BadRequest(`${field} must be YYYY-MM-DD.`);
  return s;
}
function time(v: unknown, field: string): string | null {
  const s = str(v, field, 8);
  if (s && !TIME.test(s)) throw new BadRequest(`${field} must be HH:MM.`);
  return s;
}
function money(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadRequest(`${field} must be a number.`);
  return Math.round(n * 100) / 100;
}
function arr(v: unknown, field: string, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequest(`${field} must be a list.`);
  if (v.length > max) throw new BadRequest(`${field} can have at most ${max} entries.`);
  return v;
}

/** JSON body → the same parsed input the web form produces. */
function parseBody(body: unknown): EventCreateInput {
  if (!isObj(body)) throw new BadRequest("Send a JSON object.");
  const ev = isObj(body.event) ? body.event : null;
  const fin = isObj(body.financial) ? body.financial : {};
  const venue = isObj(body.venue) ? body.venue : null;
  if (!ev) throw new BadRequest("event is required.");
  if (!venue) throw new BadRequest("venue is required.");

  const clients: NewClient[] = arr(body.clients, "clients", 10).map((raw, i) => {
    if (!isObj(raw)) throw new BadRequest(`clients[${i}] must be an object.`);
    const mode = raw.mode === "existing" ? "existing" : raw.mode === "new" ? "new" : null;
    if (!mode) throw new BadRequest(`clients[${i}].mode must be "new" or "existing".`);
    return {
      mode,
      client_id: uuid(raw.client_id, `clients[${i}].client_id`, mode === "existing") ?? undefined,
      first_name: str(raw.first_name, `clients[${i}].first_name`, 200) ?? undefined,
      last_name: str(raw.last_name, `clients[${i}].last_name`, 200) ?? undefined,
      email: str(raw.email, `clients[${i}].email`, 320) ?? undefined,
      cell_phone: str(raw.cell_phone, `clients[${i}].cell_phone`, 40) ?? undefined,
      role: str(raw.role, `clients[${i}].role`, 100) ?? undefined,
      is_primary: raw.is_primary === true,
      is_contract_holder: raw.is_contract_holder === true,
    };
  });
  if (!clients.length) throw new BadRequest("Add a primary client before creating the event.");

  const newSource = isObj(ev.new_inquiry_source) ? ev.new_inquiry_source : null;
  const customDatesRaw = ev.custom_dates;
  if (customDatesRaw !== undefined && customDatesRaw !== null && !isObj(customDatesRaw)) {
    throw new BadRequest("event.custom_dates must be an object of {definition_id: date}.");
  }
  const custom_dates = Object.entries((customDatesRaw ?? {}) as Obj).map(([defId, value]) => ({
    definition_id: uuid(defId, "event.custom_dates key", true)!,
    value: date(value, `event.custom_dates.${defId}`) ?? undefined,
  }));

  const discountsRaw = arr(fin.discounts, "financial.discounts", 2);
  const discounts = discountsRaw.map((d, i) => {
    if (!isObj(d)) throw new BadRequest(`financial.discounts[${i}] must be an object.`);
    return { label: str(d.label, `financial.discounts[${i}].label`, 200) ?? undefined, amount: money(d.amount, `financial.discounts[${i}].amount`) ?? 0 };
  });
  const addons = arr(fin.addons, "financial.addons", 100).map((a, i) => {
    if (!isObj(a)) throw new BadRequest(`financial.addons[${i}] must be an object.`);
    const qty = a.quantity === undefined || a.quantity === null ? 1 : Number(a.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequest(`financial.addons[${i}].quantity must be a whole number ≥ 1.`);
    return {
      addon_id: uuid(a.addon_id, `financial.addons[${i}].addon_id`, true)!,
      quantity: qty,
      price_override: money(a.price_override, `financial.addons[${i}].price_override`),
    };
  });
  const planRaw = fin.schedule_plan ?? "";
  if (typeof planRaw !== "string" || !/^(|full|split:\d{1,2})$/.test(planRaw.trim())) {
    throw new BadRequest(`financial.schedule_plan must be "", "full" or "split:N".`);
  }

  const staff = arr(body.staff, "staff", 20).map((s, i) => {
    if (!isObj(s)) throw new BadRequest(`staff[${i}] must be an object.`);
    return {
      employee_id: uuid(s.employee_id, `staff[${i}].employee_id`, true)!,
      role: str(s.role, `staff[${i}].role`, 100) ?? undefined,
      flat_wage: money(s.flat_wage, `staff[${i}].flat_wage`) ?? undefined,
    };
  });

  // venue → the form's three venue modes (+ a manual name/address)
  let venue_id: string | null = null;
  let venue_room_id: string | null = null;
  let new_venue: EventCreateInput["new_venue"] = null;
  let use_client_address = false;
  let client_address: string | null = null;
  switch (venue.mode) {
    case "list":
      venue_id = uuid(venue.venue_id, "venue.venue_id", true);
      venue_room_id = uuid(venue.venue_room_id, "venue.venue_room_id");
      break;
    case "google": {
      const p = isObj(venue.place) ? venue.place : null;
      if (!p) throw new BadRequest("venue.place is required.");
      const name = str(p.name, "venue.place.name", 300);
      if (!name) throw new BadRequest("venue.place.name is required.");
      new_venue = {
        name,
        address: str(p.address, "venue.place.address", 500),
        city: str(p.city, "venue.place.city", 200),
        state: str(p.state, "venue.place.state", 50),
        zip: str(p.zip, "venue.place.zip", 20),
        lat: money(p.lat, "venue.place.lat") === null ? null : Number(p.lat),
        lng: money(p.lng, "venue.place.lng") === null ? null : Number(p.lng),
        place_id: str(p.google_place_id, "venue.place.google_place_id", 300),
      };
      break;
    }
    case "manual": {
      const name = str(venue.name, "venue.name", 300);
      if (!name) throw new BadRequest("venue.name is required.");
      new_venue = { name, address: str(venue.address, "venue.address", 500) };
      break;
    }
    case "client_address":
      use_client_address = true;
      client_address = str(venue.address, "venue.address", 500);
      break;
    default:
      throw new BadRequest(`venue.mode must be "list", "google", "manual" or "client_address".`);
  }

  const guests = ev.guest_count === undefined || ev.guest_count === null || ev.guest_count === "" ? null : Number(ev.guest_count);
  if (guests !== null && (!Number.isInteger(guests) || guests < 0)) throw new BadRequest("event.guest_count must be a whole number.");

  return {
    clients,
    name: str(ev.name, "event.name", 300),
    event_type_id: uuid(ev.event_type_id, "event.event_type_id", true),
    status_id: uuid(ev.status_id, "event.status_id", true),
    event_date: date(ev.event_date, "event.event_date"),
    setup_time: time(ev.setup_time, "event.setup_time"),
    start_time: time(ev.start_time, "event.start_time"),
    end_time: time(ev.end_time, "event.end_time"),
    guest_count: guests,
    inquiry_source_id: uuid(ev.inquiry_source_id, "event.inquiry_source_id"),
    new_source_name: newSource ? str(newSource.name, "event.new_inquiry_source.name", 200) : null,
    new_source_persist: newSource?.persist === true,
    internal_notes: str(ev.internal_notes, "event.internal_notes", 20000),
    contract_notes: str(ev.contract_notes, "event.contract_notes", 20000),
    custom_dates,
    package_id: uuid(fin.package_id, "financial.package_id"),
    package_price_override: money(fin.package_price_override, "financial.package_price_override"),
    deposit_value: money(fin.deposit_value, "financial.deposit_value"),
    travel_fee: money(fin.travel_fee, "financial.travel_fee") ?? 0,
    discount1_label: null,
    discounts,
    addons,
    schedule_plan: parseSchedulePlan(planRaw),
    use_client_address,
    client_address,
    venue_id,
    venue_room_id,
    new_venue,
    staff,
  };
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Anon-key client carrying the user's JWT — RLS-authenticated like the web session,
  // so the create runs with exactly the caller's database rights.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await requireMobileStaffModule(supabase, token, "events", "edit");
  if (denied) return denied;
  const me = await getMobileMe(supabase, token);
  if (!me || me.fieldStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let input: EventCreateInput;
  try {
    input = parseBody(await req.json());
  } catch (e) {
    const msg = e instanceof BadRequest ? e.message : "Send a valid JSON body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const id = await createEventCore(supabase, input);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not create the event." }, { status: 400 });
  }
}
