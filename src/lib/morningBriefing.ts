import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatComplete, isOpenAIConfigured } from "@/lib/openai";
import { sendBrandedEmail } from "@/lib/mailgun";
import { consentedEventIds, rowsForAi } from "@/lib/aiConsent";

/* Daily morning briefing: gather the day's operational picture, let GPT write a
   friendly skimmable summary, and email it to the office. Runs from the
   /api/cron/morning-briefing route (service-role client). */

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function previewMorningDigest(admin: SupabaseClient, to = "events@xpressdjs.com"): Promise<{ to: string; subject: string; body: string }> {
  const todayStr = iso(new Date());
  const { data: events } = await admin.from("events").select("name, event_date").gte("event_date", todayStr).is("archived_at", null).order("event_date", { ascending: true }).limit(30);
  const lines = (events ?? []).map((event) => `${event.event_date}: ${event.name ?? "Event"}`).join("\n");
  return { to, subject: `Morning briefing ${todayStr}`, body: `<p>Morning briefing</p><pre>${lines}</pre>` };
}

export async function sendMorningBriefing(admin: SupabaseClient, to = "events@xpressdjs.com") {
  const today = new Date();
  const todayStr = iso(today);
  const in7 = iso(new Date(today.getTime() + 7 * DAY));
  const in14 = iso(new Date(today.getTime() + 14 * DAY));

  const [{ data: events }, { data: dues }, { data: unsigned }] = await Promise.all([
    admin
      .from("events")
      .select("id, name, event_date, start_time, venue:venues(name), status:event_statuses(name), package:packages(name)")
      .gte("event_date", todayStr)
      .lte("event_date", in14)
      .is("archived_at", null)
      .order("event_date", { ascending: true }),
    admin
      .from("scheduled_payments")
      .select("due_date, amount, label, event:events(id, name, archived_at)")
      .gte("due_date", todayStr)
      .lte("due_date", in7)
      .order("due_date", { ascending: true }),
    admin
      .from("events")
      .select("id, name, event_date, contract_sent_date")
      .not("contract_sent_date", "is", null)
      .is("contract_signed_date", null)
      .gte("event_date", todayStr)
      .is("archived_at", null)
      .order("event_date", { ascending: true }),
  ]);

  const eventIds = [
    ...(events ?? []).map((event) => event.id as string),
    ...(dues ?? []).map((row) => pluck(row, "event", "id")).filter((id): id is string => Boolean(id)),
    ...(unsigned ?? []).map((event) => event.id as string),
  ];
  const allowed = await consentedEventIds(admin, eventIds);
  const evList = (events ?? []).map((e) => ({
    id: e.id as string,
    name: (e.name as string | null) ?? "Event",
    date: e.event_date as string,
    start: e.start_time as string | null,
    venue: pluck(e, "venue", "name"),
    status: pluck(e, "status", "name"),
    package: pluck(e, "package", "name"),
    today: e.event_date === todayStr,
    allowed: allowed.has(e.id as string),
  }));
  const dueList = (dues ?? [])
    .filter((d) => !pluckRaw(d, "event")?.archived_at)
    .map((d) => {
      const eventId = pluck(d, "event", "id");
      return {
        due: d.due_date as string,
        amount: Number(d.amount) || 0,
        label: d.label as string | null,
        event: pluck(d, "event", "name"),
        allowed: Boolean(eventId) && allowed.has(eventId as string),
      };
    });
  const unsignedList = (unsigned ?? []).map((u) => ({
    name: (u.name as string | null) ?? "Event",
    date: u.event_date as string,
    sent: u.contract_sent_date as string | null,
    allowed: allowed.has(u.id as string),
  }));

  const aiData = {
    today: todayStr,
    eventsToday: rowsForAi(evList.filter((e) => e.today)),
    eventsNext14: rowsForAi(evList.filter((e) => !e.today)),
    paymentsDueNext7: rowsForAi(dueList),
    unsignedAgreements: rowsForAi(unsignedList),
  };
  const staffData = {
    today: todayStr,
    eventsToday: evList.filter((e) => e.today),
    eventsNext14: evList.filter((e) => !e.today),
    paymentsDueNext7: dueList,
    unsignedAgreements: unsignedList,
  };
  const aiHasRows =
    aiData.eventsToday.length + aiData.eventsNext14.length + aiData.paymentsDueNext7.length + aiData.unsignedAgreements.length > 0;

  let bodyHtml: string;
  if (isOpenAIConfigured() && aiHasRows) {
    const system =
      "You are the operations assistant for Xpress Entertainment, a DJ/entertainment company in South Florida. " +
      "Write a concise, friendly MORNING BRIEFING email body in simple HTML (only <h3>, <p>, <ul>, <li>, <strong>; no <html>/<head>/<style>). " +
      "Organize into: Today, This Week (next 14 days), Payments Due (next 7 days), Needs Attention (unsigned agreements). " +
      "Lead with the most important items. If a section has nothing, say so in one short line. Format dates like 'Sat, Apr 25' and money like $1,200. Keep it skimmable, short bullets, no fluff. " +
      "Only the events in this JSON have AI permission. Do not invent other client names.";
    try {
      bodyHtml = await chatComplete([
        { role: "system", content: system },
        { role: "user", content: `Today is ${todayStr}. Here is today's permitted data as JSON:\n\n${JSON.stringify(aiData)}` },
      ]);
      bodyHtml = bodyHtml.replace(/^```html?/i, "").replace(/```$/i, "").trim();
    } catch {
      bodyHtml = fallbackHtml(staffData);
    }
  } else {
    bodyHtml = fallbackHtml(staffData);
  }
  const heldBack = evList.filter((event) => !event.allowed);
  if (heldBack.length && isOpenAIConfigured() && aiHasRows) {
    bodyHtml += `<h3>Not included in the AI summary</h3><ul>${heldBack
      .map((event) => `<li>${event.date} · ${event.name}${event.venue ? ` · ${event.venue}` : ""}</li>`)
      .join("")}</ul>`;
  }

  const niceDate = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return sendBrandedEmail({
    to,
    subject: `☀️ Morning Briefing — ${niceDate}`,
    contentHtml: bodyHtml,
    supabase: admin,
  });
}

// Plain fallback if OpenAI isn't available, so the briefing still goes out.
function fallbackHtml(d: {
  today: string;
  eventsToday: { name: string; date: string; venue: string | null }[];
  eventsNext14: { name: string; date: string; venue: string | null }[];
  paymentsDueNext7: { due: string; amount: number; event: string | null }[];
  unsignedAgreements: { name: string; date: string }[];
}): string {
  const li = (s: string) => `<li>${s}</li>`;
  const list = (rows: string[]) => (rows.length ? `<ul>${rows.join("")}</ul>` : "<p>Nothing here.</p>");
  return [
    `<h3>Today</h3>`,
    list(d.eventsToday.map((e) => li(`<strong>${e.name}</strong>${e.venue ? ` · ${e.venue}` : ""}`))),
    `<h3>This week</h3>`,
    list(d.eventsNext14.map((e) => li(`${e.date} — <strong>${e.name}</strong>${e.venue ? ` · ${e.venue}` : ""}`))),
    `<h3>Payments due (next 7 days)</h3>`,
    list(d.paymentsDueNext7.map((p) => li(`${p.due} — $${p.amount.toLocaleString()} · ${p.event ?? "?"}`))),
    `<h3>Needs attention — unsigned agreements</h3>`,
    list(d.unsignedAgreements.map((u) => li(`<strong>${u.name}</strong> (${u.date})`))),
  ].join("");
}

function pluckRaw(row: unknown, key: string): { archived_at?: string | null } | null {
  const v = (row as Record<string, unknown>)[key];
  return (Array.isArray(v) ? v[0] : v) as { archived_at?: string | null } | null;
}
function pluck(row: unknown, key: string, field: string): string | null {
  const v = pluckRaw(row, key) as Record<string, unknown> | null;
  return (v?.[field] as string | undefined) ?? null;
}
