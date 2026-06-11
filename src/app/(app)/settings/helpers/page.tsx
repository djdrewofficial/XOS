import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createBlankHelper, toggleHelper, deleteHelper, moveHelper, duplicateHelper } from "./actions";

export const dynamic = "force-dynamic";

type HelperRow = {
  id: string;
  title: string;
  button_text: string;
  button_bg: string;
  button_fg: string;
  button_font_size: number | null;
  button_font_weight: number | null;
  is_active: boolean;
  auto_on_create: boolean;
  required_fields: string[] | null;
  visible_status_ids: string[];
  hide_if_payment_made: boolean;
  hide_if_already_ran: boolean;
  hide_if_helpers_ran: string[];
};

const GearIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
    <path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.18 7.18 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.13.55-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.49.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.18 7.18 0 0 0 1.62-.94l2.39.96c.21.1.48.01.61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
  </svg>
);

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
    <path d="M13 2 4.5 13.5h5L11 22l8.5-11.5h-5L13 2Z" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16h-9V7h9v14Z" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
    <path d="M6 7h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Zm3-3 1-1h4l1 1h4v2H5V4h4Zm1 6v9h2v-9h-2Zm4 0v9h2v-9h-2Z" />
  </svg>
);

export default async function HelpersPage() {
  const supabase = await createClient();
  const { data: helpers } = await supabase.from("booking_helpers").select("*").order("position");
  const list = (helpers ?? []) as HelperRow[];

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title mb-1">Booking Helpers</h1>
          <p className="text-sm text-zinc-500">
            Booking Helpers are a very powerful tool that will help you automate the event management process.
            The order here is the order the buttons appear on events.
          </p>
        </div>
        <form action={createBlankHelper}>
          <button className="btn-primary">+ Add Booking Helper</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="w-10 px-3 py-2.5"></th>
              <th className="px-4 py-2.5">Name</th>
              <th className="w-20 px-3 py-2.5 text-center">Settings</th>
              <th className="w-24 px-3 py-2.5 text-center">Automation</th>
              <th className="px-4 py-2.5 text-center">Button</th>
              <th className="w-24 px-3 py-2.5 text-center">Position</th>
              <th className="w-44 px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((h, idx) => {
              const hasConditions =
                (h.required_fields ?? []).length > 0 ||
                h.visible_status_ids.length > 0 ||
                h.hide_if_payment_made ||
                h.hide_if_already_ran ||
                h.hide_if_helpers_ran.length > 0;
              return (
                <tr key={h.id} className={`row ${!h.is_active ? "opacity-40" : ""}`}>
                  <td className="px-3 py-3 text-center text-xs text-zinc-500">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/settings/helpers/${h.id}`}
                      className="font-medium text-zinc-800 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-lighter"
                    >
                      {h.title}
                    </Link>
                    {!h.is_active && <span className="ml-2 text-[10px] font-bold uppercase text-zinc-400">disabled</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {hasConditions && (
                      <span
                        className="inline-flex size-7 items-center justify-center rounded bg-zinc-500 text-white dark:bg-zinc-600"
                        title="Has visibility conditions and/or validation rules"
                      >
                        <GearIcon />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {h.auto_on_create && (
                      <span
                        className="inline-flex size-7 items-center justify-center rounded bg-amber-500 text-white"
                        title="Runs automatically when a matching event is added"
                      >
                        <BoltIcon />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className="inline-block rounded px-3.5 py-1.5 shadow-sm"
                      style={{
                        backgroundColor: h.button_bg,
                        color: h.button_fg,
                        fontSize: `${Math.min(h.button_font_size ?? 16, 15)}px`,
                        fontWeight: h.button_font_weight ?? 900,
                      }}
                    >
                      {h.button_text}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    <form action={moveHelper.bind(null, h.id, "up")} className="inline">
                      <button
                        disabled={idx === 0}
                        className="rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-300 disabled:opacity-30 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/20"
                        title="Move up"
                      >
                        ▲
                      </button>
                    </form>
                    <form action={moveHelper.bind(null, h.id, "down")} className="ml-1 inline">
                      <button
                        disabled={idx === list.length - 1}
                        className="rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-300 disabled:opacity-30 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/20"
                        title="Move down"
                      >
                        ▼
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/settings/helpers/${h.id}`}
                      className="inline-flex items-center rounded bg-gradient-to-r from-brand to-brand-light px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110"
                    >
                      EDIT
                    </Link>
                    <form action={duplicateHelper.bind(null, h.id)} className="ml-1.5 inline">
                      <button
                        className="inline-flex size-7 items-center justify-center rounded bg-zinc-500 text-white hover:brightness-110 dark:bg-zinc-600"
                        title="Duplicate"
                      >
                        <CopyIcon />
                      </button>
                    </form>
                    <form action={toggleHelper.bind(null, h.id, !h.is_active)} className="ml-1.5 inline">
                      <button
                        className="inline-flex h-7 items-center justify-center rounded bg-zinc-500 px-2 text-[10px] font-bold text-white hover:brightness-110 dark:bg-zinc-600"
                        title={h.is_active ? "Disable" : "Enable"}
                      >
                        {h.is_active ? "OFF" : "ON"}
                      </button>
                    </form>
                    <form action={deleteHelper.bind(null, h.id)} className="ml-1.5 inline">
                      <button
                        className="inline-flex size-7 items-center justify-center rounded bg-red-700 text-white hover:brightness-110"
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No booking helpers yet — click “+ Add Booking Helper” to create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
