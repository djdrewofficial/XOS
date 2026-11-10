import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendBrandedEmail } from "@/lib/mailgun";

/* Personalized daily briefing, one email per staff member: their upcoming events.
   Who gets it and how often is set in Settings → Daily Briefing (staff_briefing_prefs).
   Runs from /api/cron/ai-tasks at the configured hour in the company timezone;
   per-staff last_sent_on prevents same-day repeats. */

const TZ = "America/New_York";
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Pref = { employee_id: string; enabled: boolean; frequency: string; last_sent_on: string | null };
type Emp = { id: string; first_name: string | null; last_name: string | null; stage_name: string | null; email: string | null; is_active: boolean };

function localToday(): { date: string; dow: number; nice: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const nice = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(now);
  return { date, dow: map[wd] ?? 0, nice };
}

/** Whether a staffer is due a briefing today, given their cadence + last send. */
function isDue(frequency: string, lastSentOn: string | null, today: string, dow: number): boolean {
  if (lastSentOn === today) return false; // already sent today
  if (frequency === "weekdays") return dow >= 1 && dow <= 5;
  if (frequency === "weekly") return dow === 1; // Mondays
  return true; // daily
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export async function previewStaffBriefings(admin: SupabaseClient): Promise<{ employeeId: string; to: string; subject: string; body: string }[]> {
  const { date: today, dow, nice } = localToday();
  const horizon = iso(new Date(new Date().getTime() + 21 * DAY));
  const { data: prefsRaw } = await admin.from("staff_briefing_prefs").select("employee_id,enabled,frequency,last_sent_on").eq("enabled", true);
  const prefs = (prefsRaw ?? []) as Pref[];
  if (prefs.length === 0) return [];
  const { data: empsRaw } = await admin.from("employees").select("id,first_name,last_name,stage_name,email,is_active").in("id", prefs.map((p) => p.employee_id));
  const empById = new Map<string, Emp>((empsRaw ?? []).map((e) => [e.id as string, e as Emp]));
  const due = prefs.filter((p) => {
    const e = empById.get(p.employee_id);
    return e && e.is_active && e.email && isDue(p.frequency, p.last_sent_on, today, dow);
  });
  if (due.length === 0) return [];
  const { data: staffEvents } = await admin
    .from("event_staff")
    .select("employee_id,role,event:events(name,event_date,start_time,archived_at,venue:venues(name))")
    .in("employee_id", due.map((p) => p.employee_id));
  type EvRow = { employee_id: string; role: string | null; event: { name?: string; event_date?: string; start_time?: string; archived_at?: string | null; venue?: { name?: string } | null } | null };
  const eventsByEmp = new Map<string, EvRow[]>();
  for (const e of (staffEvents ?? []) as unknown as EvRow[]) {
    const ev = e.event;
    if (!ev || ev.archived_at || !ev.event_date || ev.event_date < today || ev.event_date > horizon) continue;
    const arr = eventsByEmp.get(e.employee_id) ?? [];
    arr.push(e);
    eventsByEmp.set(e.employee_id, arr);
  }
  return due.map((p) => {
    const emp = empById.get(p.employee_id)!;
    const firstName = emp.first_name || emp.stage_name || "there";
    const myEvents = (eventsByEmp.get(p.employee_id) ?? []).sort((a, b) => (a.event!.event_date! < b.event!.event_date! ? -1 : 1));
    const eventsHtml = myEvents.length
      ? `<ul>${myEvents.map((e) => `<li>${esc(e.event?.name ?? "Event")}</li>`).join("")}</ul>`
      : "<p>No events assigned to you in the next 3 weeks.</p>";
    return {
      employeeId: p.employee_id,
      to: emp.email as string,
      subject: `Your Daily Briefing — ${nice}`,
      body: `<p>Good morning, ${esc(firstName)}.</p>${eventsHtml}`,
    };
  });
}

export async function sendStaffBriefings(admin: SupabaseClient): Promise<{ sent: number }> {
  const { date: today, dow, nice } = localToday();
  const horizon = iso(new Date(new Date().getTime() + 21 * DAY));

  const { data: prefsRaw } = await admin
    .from("staff_briefing_prefs")
    .select("employee_id,enabled,frequency,last_sent_on")
    .eq("enabled", true);
  const prefs = (prefsRaw ?? []) as Pref[];
  if (prefs.length === 0) return { sent: 0 };

  const { data: empsRaw } = await admin
    .from("employees")
    .select("id,first_name,last_name,stage_name,email,is_active")
    .in("id", prefs.map((p) => p.employee_id));
  const empById = new Map<string, Emp>((empsRaw ?? []).map((e) => [e.id as string, e as Emp]));

  const due = prefs.filter((p) => {
    const e = empById.get(p.employee_id);
    return e && e.is_active && e.email && isDue(p.frequency, p.last_sent_on, today, dow);
  });
  if (due.length === 0) return { sent: 0 };
  const dueIds = due.map((p) => p.employee_id);

  const { data: staffEvents } = await admin
    .from("event_staff")
    .select("employee_id,role,event:events(name,event_date,start_time,archived_at,venue:venues(name))")
    .in("employee_id", dueIds);

  type EvRow = { employee_id: string; role: string | null; event: { name?: string; event_date?: string; start_time?: string; archived_at?: string | null; venue?: { name?: string } | null } | null };

  const eventsByEmp = new Map<string, EvRow[]>();
  for (const e of (staffEvents ?? []) as unknown as EvRow[]) {
    const ev = e.event;
    if (!ev || ev.archived_at || !ev.event_date) continue;
    if (ev.event_date < today || ev.event_date > horizon) continue;
    const arr = eventsByEmp.get(e.employee_id) ?? [];
    arr.push(e);
    eventsByEmp.set(e.employee_id, arr);
  }

  let sent = 0;
  for (const p of due) {
    const emp = empById.get(p.employee_id)!;
    const firstName = emp.first_name || emp.stage_name || "there";
    const myEvents = (eventsByEmp.get(p.employee_id) ?? []).sort((a, b) => (a.event!.event_date! < b.event!.event_date! ? -1 : 1));

    const eventsHtml = myEvents.length
      ? `<ul>${myEvents
          .map((e) => {
            const ev = e.event!;
            const venue = ev.venue?.name ? ` · ${esc(ev.venue.name)}` : "";
            const role = e.role ? ` <span style="color:#888">(${esc(e.role)})</span>` : "";
            return `<li><strong>${usDate(ev.event_date!)}</strong> — ${esc(ev.name ?? "Event")}${venue}${role}</li>`;
          })
          .join("")}</ul>`
      : "<p>No events assigned to you in the next 3 weeks.</p>";

    const contentHtml = [
      `<p>Good morning, ${esc(firstName)}! Here's your day.</p>`,
      `<h3>📅 Your upcoming events</h3>`,
      eventsHtml,
      `<p style="color:#888;font-size:12px">Manage your briefing preferences with your manager (Settings → Daily Briefing).</p>`,
    ].join("");

    const res = await sendBrandedEmail({
      to: emp.email as string,
      subject: `☀️ Your Daily Briefing — ${nice}`,
      contentHtml,
      supabase: admin,
    });
    if (res.ok) {
      await admin
        .from("staff_briefing_prefs")
        .update({ last_sent_on: today, updated_at: new Date().toISOString() })
        .eq("employee_id", p.employee_id);
      sent++;
    }
  }

  return { sent };
}
