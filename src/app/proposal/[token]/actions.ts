"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEventBundle, generateDocumentRow } from "@/lib/documentRender";
import { buildScheduleRows, type SchedulePlan } from "@/lib/paymentSchedule";
import { resolveJourney, officePlan, type BillingTerms } from "@/lib/journeyConfig";
import { autoNameEvent } from "@/lib/eventName";

const BOOKING_AGREEMENT_ID = "e2ae8026-0d1a-4681-be90-f130d572aec4";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

/* Public confirm step: the couple/contact edits their details + (when they're
   the ones choosing) picks a payment plan; we (re)build the schedule, capture
   autopay consent, generate the per-event-type contract and forward to sign it.
   Service role — the pay_token is the authorization. Chooser/template/terms are
   resolved here authoritatively (never trusted from the client). */
export async function confirmProposal(token: string, formData: FormData) {
  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, event_date, deposit_value, venue_id, package_id, event_type_id, billing_terms, billing_terms_count")
    .eq("pay_token", token)
    .maybeSingle();
  if (!event) redirect(`/proposal/${token}?error=invalid`);
  const eventId = event.id as string;

  // resolve this event type's workflow (contract template + payment chooser)
  const [typeRes, jsRes] = await Promise.all([
    event.event_type_id
      ? supabase
          .from("event_types")
          .select("proposal_doc_template_id, proposal_layout, payment_chooser")
          .eq("id", event.event_type_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("journey_settings")
      .select("proposal_doc_template_id, proposal_layout, payment_chooser")
      .eq("id", true)
      .maybeSingle(),
  ]);
  const journey = resolveJourney(typeRes.data, jsRes.data);

  // ---- 1) write the submitted edits ----------------------------------------
  const { data: ecs } = await supabase
    .from("event_clients")
    .select("id, client_id, is_primary, created_at")
    .eq("event_id", eventId)
    .order("is_primary", { ascending: false })
    .order("created_at");
  const primary = (ecs ?? []).find((e) => e.is_primary) ?? (ecs ?? [])[0] ?? null;
  const partnerB = (ecs ?? []).find((e) => !e.is_primary) ?? null;

  // primary contact (Partner A / business contact)
  if (primary) {
    const update: Record<string, unknown> = {
      first_name: clean(formData.get("a_first")) ?? "",
      last_name: clean(formData.get("a_last")) ?? "",
      email: clean(formData.get("a_email")),
      cell_phone: clean(formData.get("a_cell")),
    };
    if (formData.has("organization")) update.organization = clean(formData.get("organization"));
    await supabase.from("clients").update(update).eq("id", primary.client_id);
  }

  // Partner B — only when the couple layout submitted those fields
  if (formData.has("b_first") || formData.has("b_email")) {
    const bFirst = clean(formData.get("b_first"));
    const bLast = clean(formData.get("b_last"));
    const bEmail = clean(formData.get("b_email"));
    const bCell = clean(formData.get("b_cell"));
    const hasB = bFirst || bLast || bEmail || bCell;
    if (partnerB) {
      await supabase
        .from("clients")
        .update({ first_name: bFirst ?? "", last_name: bLast ?? "", email: bEmail, cell_phone: bCell })
        .eq("id", partnerB.client_id);
    } else if (hasB) {
      const { data: newClient } = await supabase
        .from("clients")
        .insert({ first_name: bFirst ?? "", last_name: bLast ?? "", email: bEmail, cell_phone: bCell })
        .select("id")
        .single();
      if (newClient) {
        await supabase
          .from("event_clients")
          .insert({ event_id: eventId, client_id: newClient.id, role: "Partner", is_primary: false });
      }
    }
  }

  // Venue — update the attached venue, or create one if none is attached yet.
  // Google place fields are only written when the client actually re-picked a
  // venue (place_id present), so existing city/state/geo isn't clobbered.
  if (formData.has("venue_name")) {
    const venueName = clean(formData.get("venue_name"));
    const venueAddress = clean(formData.get("venue_address"));
    const placeId = clean(formData.get("venue_place_id"));
    const num = (v: FormDataEntryValue | null) => {
      const n = parseFloat((v ?? "").toString());
      return Number.isFinite(n) ? n : null;
    };
    const geo = placeId
      ? {
          city: clean(formData.get("venue_city")),
          state: clean(formData.get("venue_state")),
          zip: clean(formData.get("venue_zip")),
          lat: num(formData.get("venue_lat")),
          lng: num(formData.get("venue_lng")),
          google_place_id: placeId,
        }
      : {};
    if (event.venue_id) {
      await supabase.from("venues").update({ name: venueName ?? "", address: venueAddress, ...geo }).eq("id", event.venue_id);
    } else if (venueName) {
      const { data: newVenue } = await supabase
        .from("venues")
        .insert({ name: venueName, address: venueAddress, ...geo })
        .select("id")
        .single();
      if (newVenue) await supabase.from("events").update({ venue_id: newVenue.id }).eq("id", eventId);
    }
  }

  // Event timing — setup time is internal (not on the client form), so leave it untouched
  const newDate = clean(formData.get("event_date"));
  await supabase
    .from("events")
    .update({
      event_date: newDate,
      start_time: clean(formData.get("start_time")),
      end_time: clean(formData.get("end_time")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  // ---- 2) (re)build the payment schedule -----------------------------------
  const bundle = await loadEventBundle(supabase, eventId); // fresh totals after edits
  const total = bundle?.total ?? 0;
  const deposit = Number(event.deposit_value ?? 0);

  let terms: "days_before" | "net_days_after" = "days_before";
  let termsDays = 30;
  if (event.package_id) {
    const { data: pkg } = await supabase
      .from("packages")
      .select("payment_terms, payment_terms_days")
      .eq("id", event.package_id)
      .maybeSingle();
    if (pkg) {
      terms = (pkg.payment_terms as typeof terms) ?? "days_before";
      termsDays = pkg.payment_terms_days ?? 30;
    }
  }

  // office decides → use the event's billing terms; client decides → use their pick
  let plan: SchedulePlan;
  if (journey.chooser === "office") {
    plan = officePlan(event.billing_terms as BillingTerms | null, event.billing_terms_count ?? 2);
  } else {
    const planRaw = (formData.get("plan") ?? "full").toString();
    plan = planRaw.startsWith("split:")
      ? { kind: "split", count: Math.max(1, parseInt(planRaw.slice(6), 10) || 1) }
      : { kind: "full" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = buildScheduleRows({ total, deposit, eventDate: newDate, terms, termsDays, plan, today }).map((r) => ({
    ...r,
    event_id: eventId,
  }));
  await supabase.from("scheduled_payments").delete().eq("event_id", eventId);
  await supabase.from("scheduled_payments").insert(rows);

  // auto-name the event now that the couple's info is in ("Alex & Sam's Wedding")
  await autoNameEvent(supabase, eventId);

  // (autopay is chosen later, on the payment screen — not here)

  // ---- 4) generate the per-type contract, then send them to sign -----------
  const templateId = journey.templateId ?? BOOKING_AGREEMENT_ID;
  const doc = await generateDocumentRow(supabase, templateId, eventId, "sent");
  if (!doc) redirect(`/proposal/${token}?error=gen`);

  redirect(`/sign/${doc.access_token}`);
}
