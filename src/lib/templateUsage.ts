/* Works out where an email template is "used". The meaningful signal is booking
   helpers whose actions JSONB contains a send_email / send_email_staff step that
   references the template by id. Pure functions so both the templates list page
   and the template editor can compute usage from one booking_helpers fetch. */

export type HelperRow = {
  id: string;
  title: string | null;
  is_active: boolean;
  actions: unknown;
};

export type HelperRef = { id: string; title: string; isActive: boolean };

/** Map of template id → booking helpers that send it (each helper listed once). */
export function mapTemplateHelperUsage(helpers: HelperRow[]): Record<string, HelperRef[]> {
  const out: Record<string, HelperRef[]> = {};
  for (const h of helpers) {
    const acts = Array.isArray(h.actions) ? h.actions : [];
    const seen = new Set<string>();
    for (const a of acts) {
      if (!a || typeof a !== "object") continue;
      const act = a as Record<string, unknown>;
      if (act.type !== "send_email" && act.type !== "send_email_staff") continue;
      const tid = typeof act.template_id === "string" ? act.template_id : null;
      if (!tid || seen.has(tid)) continue;
      seen.add(tid);
      (out[tid] ??= []).push({ id: h.id, title: h.title ?? "Untitled helper", isActive: h.is_active });
    }
  }
  return out;
}

/** Booking helpers that send one specific template. */
export function helpersForTemplate(helpers: HelperRow[], templateId: string): HelperRef[] {
  return mapTemplateHelperUsage(helpers)[templateId] ?? [];
}
