import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClientProfileCard from "@/components/ClientProfileCard";
import LoginAccess from "@/components/LoginAccess";
import SmsSubscription from "@/components/SmsSubscription";
import AnonymizeClient from "@/components/AnonymizeClient";
import { updateClientRecord, inviteClient, resetClientPassword, setClientSmsOptOut, setClientSmsConsent, anonymizeClient } from "../actions";
import { getSmsOptStatus } from "@/lib/smsOptOut";
import { money, eventTotal, type Client, type XEvent } from "@/lib/types";
import { mergeClientEvents } from "@/lib/clientEvents";
import PhoneSyncNote from "@/components/PhoneSyncNote";

export const dynamic = "force-dynamic";

const EVENT_SELECT = "*, status:event_statuses(*), package:packages(*), venue:venues(*)";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Primary = events.client_id; linked = event_clients (co-client / contract holder / etc.).
  // Same union the clients list page builds — without it, people like Mia Fusca
  // (on event_clients while the planner owns events.client_id) show zero events.
  const [{ data: client }, { data: primaryEvents }, { data: linkedRows }, { data: account }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("events")
      .select(EVENT_SELECT)
      .eq("client_id", id)
      .order("event_date", { ascending: false }),
    supabase
      .from("event_clients")
      .select(`role, event:events(${EVENT_SELECT})`)
      .eq("client_id", id),
    supabase.from("accounts").select("auth_user_id").eq("client_id", id).maybeSingle(),
  ]);

  if (!client) notFound();

  // PostgREST types many-to-one embeds as arrays; runtime is a single object (or null).
  type LinkedRow = { role: string | null; event: XEvent | XEvent[] | null };
  const linkRows = ((linkedRows ?? []) as LinkedRow[]).map((row) => ({
    role: row.role,
    event: Array.isArray(row.event) ? (row.event[0] ?? null) : row.event,
  }));
  const events = mergeClientEvents((primaryEvents ?? []) as XEvent[], linkRows);

  const smsStatus = await getSmsOptStatus(supabase, (client as Client).cell_phone ?? null);

  return (
    <div className="max-w-4xl space-y-6">
      <PhoneSyncNote />
      <ClientProfileCard client={client as Client} action={updateClientRecord.bind(null, id)} />

      <div>
      <h2 className="card-title">Events</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="row hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className="px-4 py-2">{e.event_date ?? "—"}</td>
                <td className="px-4 py-2">
                  <Link href={`/events/${e.id}`} className="text-brand dark:text-brand-lighter hover:underline">
                    {e.name || "(unnamed)"}
                  </Link>
                  {e.client_role ? (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{e.client_role}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  {e.status && (
                    <span
                      className="rounded px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: e.status.color, color: e.status.text_color }}
                    >
                      {e.status.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{e.venue?.name ?? "—"}</td>
                <td className="px-4 py-2 text-right">{money(eventTotal(e))}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-600 dark:text-zinc-400">
                  No events for this client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      <LoginAccess
        subjectId={id}
        linked={!!account?.auth_user_id}
        email={client.email ?? null}
        invite={inviteClient}
        reset={resetClientPassword}
        hasLoginLabel="Has a planning-portal login"
        noLoginLabel="No portal login yet"
        footer={
          <>
            Invites email a secure link to set a password and sign in to the client planning portal
            (music &amp; timeline).
          </>
        }
      />

      <SmsSubscription
        clientId={id}
        status={smsStatus}
        action={setClientSmsOptOut}
        marketingConsent={(client as { sms_opt_in?: boolean }).sms_opt_in === true}
        marketingConsentAt={(client as { sms_opt_in_at?: string | null }).sms_opt_in_at ?? null}
        consentAction={setClientSmsConsent}
      />

      <AnonymizeClient
        clientId={id}
        anonymizedAt={(client as { anonymized_at?: string | null }).anonymized_at ?? null}
        action={anonymizeClient}
      />
    </div>
  );
}
