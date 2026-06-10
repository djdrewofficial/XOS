import { runBookingHelper } from "@/app/(app)/events/actions";

type Helper = {
  id: string;
  title: string;
  button_text: string;
  button_bg: string;
  button_fg: string;
  visible_status_ids: string[];
  hide_if_payment_made: boolean;
  hide_if_already_ran: boolean;
  hide_if_helpers_ran: string[];
};

export default function BookingHelperBar({
  eventId,
  statusId,
  helpers,
  ranHelperIds,
  hasPayments,
}: {
  eventId: string;
  statusId: string | null;
  helpers: Helper[];
  ranHelperIds: string[];
  hasPayments: boolean;
}) {
  const visible = helpers.filter((h) => {
    if (h.visible_status_ids.length > 0 && (!statusId || !h.visible_status_ids.includes(statusId)))
      return false;
    if (h.hide_if_payment_made && hasPayments) return false;
    if (h.hide_if_already_ran && ranHelperIds.includes(h.id)) return false;
    if (h.hide_if_helpers_ran.some((id) => ranHelperIds.includes(id))) return false;
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <div className="mb-6 card p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
        Booking Helpers
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((h) => (
          <form key={h.id} action={runBookingHelper.bind(null, eventId, h.id)}>
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-sm font-bold shadow-sm transition-transform hover:scale-105"
              style={{ backgroundColor: h.button_bg, color: h.button_fg }}
            >
              {h.button_text}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
