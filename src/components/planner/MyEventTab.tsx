import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faCommentSms, faBoxOpen, faMoneyBillWave } from "@fortawesome/free-solid-svg-icons";
import type { EventAccount, SentEmail, SentText } from "@/lib/eventAccount";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function MyEventTab({
  account, messages,
}: {
  account: EventAccount | null;
  messages: { emails: SentEmail[]; texts: SentText[] };
}) {
  if (!account) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.02]">
        Your event details will appear here once your booking is set up.
      </div>
    );
  }
  const fin = account.financialsVisible;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Package */}
      <Card icon={faBoxOpen} title="Your package">
        <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{account.packageName ?? "Custom package"}</p>
        {account.includedHours != null && <p className="mt-0.5 text-sm font-semibold text-brand dark:text-brand-lighter">{account.includedHours} hours of entertainment</p>}
        {account.packageDescription && <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{account.packageDescription}</p>}
        {account.addons.length > 0 && (
          <div className="mt-4">
            <Label>What&apos;s included</Label>
            <ul className="mt-1.5 space-y-1.5">
              {account.addons.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-200">{a.qty > 1 ? `${a.qty}× ` : ""}{a.name}</span>
                  {fin && <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{money(a.price)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Financials */}
      {fin ? (
        <Card icon={faMoneyBillWave} title="Your investment">
          <div className="space-y-1.5 text-sm">
            <Row label="Package" value={money(account.packagePrice)} />
            {account.addons.length > 0 && <Row label="Add-ons" value={money(account.addons.reduce((s, a) => s + a.price, 0))} />}
            {account.travelFee > 0 && <Row label="Travel" value={money(account.travelFee)} />}
            {account.overtimeFee > 0 && <Row label="Overtime" value={money(account.overtimeFee)} />}
            {account.discounts.map((d, i) => <Row key={i} label={d.label} value={`– ${money(d.amount)}`} accent="text-emerald-600 dark:text-emerald-400" />)}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
            <Stat label="Total" value={money(account.total)} />
            <Stat label="Paid" value={money(account.paid)} cls="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Balance" value={money(account.balance)} cls={account.balance > 0 ? "text-brand dark:text-brand-lighter" : "text-emerald-600 dark:text-emerald-400"} />
          </div>

          {account.schedule.length > 0 && (
            <div className="mt-4">
              <Label>Payment schedule</Label>
              <ul className="mt-1.5 space-y-1.5">
                {account.schedule.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-700 dark:text-zinc-200">{s.label || `Payment ${s.seq}`}{s.dueDate ? <span className="text-zinc-400"> · due {fmtDate(s.dueDate)}</span> : null}</span>
                    <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{money(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {account.payments.length > 0 && (
            <div className="mt-4">
              <Label>Payments made</Label>
              <ul className="mt-1.5 space-y-1.5">
                {account.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-700 dark:text-zinc-200">
                      {p.reason || p.method || "Payment"}<span className="text-zinc-400"> · {fmtDate(p.paidAt)}{p.pending ? " · pending" : ""}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${p.pending ? "text-zinc-400" : "text-emerald-600 dark:text-emerald-400"}`}>{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {account.billingTerms && <p className="mt-4 text-xs leading-relaxed text-zinc-400">{account.billingTerms}</p>}
        </Card>
      ) : (
        <Card icon={faMoneyBillWave} title="Your investment">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Reach out to your Xpress team for any billing questions.</p>
        </Card>
      )}

      {/* Emails sent */}
      <Card icon={faEnvelope} title={`Emails we've sent you${messages.emails.length ? ` · ${messages.emails.length}` : ""}`}>
        {messages.emails.length === 0 ? (
          <p className="text-sm text-zinc-400">No emails yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.emails.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 dark:border-white/5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-700 dark:text-zinc-200">{e.subject || "(no subject)"}</span>
                  <span className="text-xs text-zinc-400">{fmtDateTime(e.sentAt)}{e.openedAt ? " · opened" : ""}</span>
                </span>
                <StatusPill status={e.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Texts sent */}
      <Card icon={faCommentSms} title={`Texts we've sent you${messages.texts.length ? ` · ${messages.texts.length}` : ""}`}>
        {messages.texts.length === 0 ? (
          <p className="text-sm text-zinc-400">No texts yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.texts.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 dark:border-white/5">
                <span className="min-w-0">
                  <span className="block text-zinc-700 dark:text-zinc-200">{t.body || "(no content)"}</span>
                  <span className="text-xs text-zinc-400">{fmtDateTime(t.sentAt)}</span>
                </span>
                <StatusPill status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ icon, title, children }: { icon: typeof faEnvelope; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-400">
        <FontAwesomeIcon icon={icon} className="text-brand dark:text-brand-lighter" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{children}</p>;
}
function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={accent ?? "text-zinc-700 dark:text-zinc-200"}>{value}</span>
    </div>
  );
}
function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${cls ?? "text-zinc-900 dark:text-zinc-50"}`}>{value}</p>
    </div>
  );
}
function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const ok = /deliver|sent|open/i.test(status);
  const bad = /fail|bounce|error|complain/i.test(status);
  const cls = bad
    ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
    : ok
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
    : "bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>{status}</span>;
}
