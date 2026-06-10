import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money, eventTotal, type XEvent, type ScheduledPayment, type Payment } from "@/lib/types";
import { addPayment, addScheduledPayments, addEventNote, setEventStatus } from "../actions";
import BookingHelperBar from "@/components/BookingHelperBar";
import StaffSection from "@/components/StaffSection";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "*, client:clients(*), status:event_statuses(*), venue:venues(*), package:packages(*), event_type:event_types(*), salesperson:employees(*), inquiry_source:inquiry_sources(*)"
    )
    .eq("id", id)
    .single<XEvent & { inquiry_source: { name: string } | null }>();

  if (!event) notFound();

  const [
    { data: schedule },
    { data: payments },
    { data: notes },
    { data: statuses },
    { data: helpers },
    { data: helperRuns },
    { data: staff },
    { data: employees },
  ] = await Promise.all([
    supabase.from("scheduled_payments").select("*").eq("event_id", id).order("seq"),
    supabase.from("payments").select("*").eq("event_id", id).order("paid_at"),
    supabase.from("event_notes").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("event_statuses").select("id, name, color, text_color").eq("is_active", true).order("sort_order"),
    supabase.from("booking_helpers").select("*").eq("is_active", true).order("position"),
    supabase.from("booking_helper_runs").select("helper_id").eq("event_id", id),
    supabase.from("event_staff").select("*, employee:employees(*)").eq("event_id", id),
    supabase.from("employees").select("*").eq("is_active", true).order("first_name"),
  ]);

  const total = eventTotal(event);
  const paid = (payments ?? []).reduce((s: number, p: Payment) => s + Number(p.amount), 0);
  const balance = total - paid;
  const cf = (event.custom_fields ?? {}) as Record<string, string>;

  const addPaymentBound = addPayment.bind(null, id);
  const addScheduleBound = addScheduledPayments.bind(null, id);
  const addNoteBound = addEventNote.bind(null, id);

  const input =
    "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none bg-white";

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{event.name || "(unnamed event)"}</h1>
          <p className="text-sm text-zinc-500">
            {event.event_date ?? "no date"} · {event.event_type?.name ?? "—"} ·{" "}
            {event.client ? `${event.client.first_name} ${event.client.last_name}` : "no client"} ·{" "}
            {event.venue?.name ?? "no venue"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {event.status && (
            <span
              className="rounded px-3 py-1.5 text-sm font-bold"
              style={{ backgroundColor: event.status.color, color: event.status.text_color }}
            >
              {event.status.name}
            </span>
          )}
          <Link
            href={`/events/${id}/edit`}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Edit
          </Link>
        </div>
      </div>

      <BookingHelperBar
        eventId={id}
        statusId={event.status_id}
        helpers={helpers ?? []}
        ranHelperIds={(helperRuns ?? []).map((r) => r.helper_id)}
        hasPayments={(payments ?? []).length > 0}
      />

      {/* quick status change */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {(statuses ?? []).map((s) => (
          <form key={s.id} action={setEventStatus.bind(null, id, s.id)}>
            <button
              type="submit"
              className={`rounded px-2.5 py-1 text-xs font-semibold ring-violet-500 hover:ring-2 ${
                s.id === event.status_id ? "ring-2 ring-zinc-800" : ""
              }`}
              style={{ backgroundColor: s.color, color: s.text_color }}
            >
              {s.name}
            </button>
          </form>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Financials */}
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">
            Financials Overview
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Package</dt><dd>{event.package?.name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Total Fee</dt><dd className="font-semibold">{money(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Payments Received</dt><dd className="text-green-700">{money(paid)}</dd></div>
            <div className="flex justify-between border-t border-zinc-100 pt-1.5"><dt className="font-semibold">Outstanding Balance</dt><dd className="font-bold">{money(balance)}</dd></div>
          </dl>

          <h3 className="mt-5 mb-2 text-xs font-bold uppercase text-zinc-500">Add Payment</h3>
          <form action={addPaymentBound} className="space-y-2">
            <input type="number" step="0.01" name="amount" placeholder="Amount" required className={input} />
            <div className="flex gap-2">
              <select name="method" className={input}>
                {["card", "cash", "check", "zelle", "venmo", "ach", "other"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input type="date" name="paid_at" className={input} />
            </div>
            <button className="w-full rounded-md bg-green-700 py-2 text-sm font-semibold text-white hover:bg-green-800">
              Add Payment
            </button>
          </form>
        </div>

        {/* Scheduled payments */}
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">
            Scheduled Payments
          </h2>
          <ul className="mb-4 space-y-1.5 text-sm">
            {(schedule ?? []).map((sp: ScheduledPayment) => (
              <li key={sp.id} className="flex justify-between">
                <span className="text-zinc-600">
                  #{sp.seq} {sp.label} · due {sp.due_date ?? "—"}
                </span>
                <span className="font-semibold">{money(sp.amount)}</span>
              </li>
            ))}
            {(schedule ?? []).length === 0 && (
              <li className="text-zinc-400">No payment schedule yet.</li>
            )}
          </ul>
          <h3 className="mb-2 text-xs font-bold uppercase text-zinc-500">
            Generate Schedule (auto-split)
          </h3>
          <form action={addScheduleBound} className="space-y-2">
            <input type="hidden" name="total" value={total} />
            <input type="hidden" name="event_date" value={event.event_date ?? ""} />
            <div className="flex gap-2">
              <input type="number" step="0.01" name="deposit" defaultValue={event.deposit_value || event.package?.deposit_value || 0} className={input} placeholder="Deposit" />
              <input type="number" name="count" defaultValue={2} min={1} max={12} className={input} placeholder="# payments" />
            </div>
            <button className="w-full rounded-md bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Auto-Split Balance
            </button>
            <p className="text-xs text-zinc-400">
              Deposit + N payments, evenly split, spaced 30 days before the event. Unlimited count (DJEP capped at 3).
            </p>
          </form>
        </div>

        {/* Client + custom fields */}
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">Client</h2>
          {event.client ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Name</dt><dd>
                <Link href={`/clients/${event.client.id}`} className="text-violet-700 hover:underline">
                  {event.client.first_name} {event.client.last_name}
                </Link>
              </dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Cell</dt><dd>{event.client.cell_phone ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Email</dt><dd>{event.client.email ?? "—"}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-400">No client linked.</p>
          )}

          <h2 className="mt-5 mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">Links</h2>
          <ul className="space-y-1 text-sm">
            {[
              ["Drive Timeline", cf.gdrive_timeline],
              ["Drive Folder", cf.gdrive_folder],
              ["Vibo", cf.vibo_link],
              ["Photo Booth Gallery", cf.photobooth_gallery],
            ].map(([label, url]) =>
              url ? (
                <li key={label}>
                  <a href={url} target="_blank" className="text-violet-700 hover:underline">
                    {label} ↗
                  </a>
                </li>
              ) : null
            )}
          </ul>

          <h2 className="mt-5 mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">
            Important Dates
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Initial Contact</dt><dd>{event.initial_contact_date ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Contract Sent</dt><dd>{event.contract_sent_date ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Contract Due</dt><dd>{event.contract_due_date ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Contract Signed</dt><dd>{event.contract_signed_date ?? "—"}</dd></div>
          </dl>
        </div>
      </div>

      <div className="mt-6">
        <StaffSection eventId={id} staff={staff ?? []} employees={employees ?? []} />
      </div>

      {/* Payments log + notes */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">Payment Log</h2>
          <ul className="divide-y divide-zinc-100 text-sm">
            {(payments ?? []).map((p: Payment) => (
              <li key={p.id} className="flex justify-between py-2">
                <span className="text-zinc-600">
                  {new Date(p.paid_at).toLocaleDateString()} · {p.method}
                  {p.notes ? ` · ${p.notes}` : ""}
                </span>
                <span className="font-semibold text-green-700">{money(p.amount)}</span>
              </li>
            ))}
            {(payments ?? []).length === 0 && <li className="py-2 text-zinc-400">No payments yet.</li>}
          </ul>
        </div>

        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-violet-700">
            Internal Notes / Booking Comments
          </h2>
          <form action={addNoteBound} className="mb-3 flex gap-2">
            <input name="body" placeholder="Add a note…" className={input} />
            <button className="rounded-md bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">
              Add
            </button>
          </form>
          {event.internal_notes && (
            <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-zinc-700">{event.internal_notes}</p>
          )}
          <ul className="space-y-2 text-sm">
            {(notes ?? []).map((n: { id: string; body: string; created_at: string }) => (
              <li key={n.id} className="rounded bg-zinc-50 p-2">
                <span className="text-zinc-700">{n.body}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
