import { money } from "@/lib/types";
import { feeSummary, type EventBundle } from "@/lib/documentRender";

/* Shared helpers for the client signing flow. All email HTML is table-free-ish,
   inline-styled, single-column — built for real email clients. */

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "TBD";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Branded email wrapper: gradient header with the white logo, white card body.
    The outbox wraps every template email in this at send time. */
export function emailShell(companyName: string, contentHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="margin:0;padding:0;background:#f4f2fa;font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:28px 14px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e4f3;">
      <div style="background:#4b328e;background:linear-gradient(110deg,#4b328e 0%,#8b6fd6 100%);padding:30px;text-align:center;">
        <img src="${appUrl()}/logo-dark.png" alt="${esc(companyName)}" width="210" style="display:inline-block;max-width:210px;" />
      </div>
      ${contentHtml}
      <div style="padding:18px 30px;border-top:1px solid #efecf7;color:#8a8a94;font-size:12px;text-align:center;">${esc(companyName)}</div>
    </div>
  </div>
</body></html>`;
}

const SECTION_LABEL =
  "font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8b6fd6;font-weight:800;margin:26px 0 8px;";
const LINE_ROW =
  "display:block;border-bottom:1px solid #f0edf8;padding:10px 0;";

function lineHtml(name: string, amount: number, description?: string | null, color?: string): string {
  return `<div style="${LINE_ROW}">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:14px;font-weight:700;color:${color ?? "#1d1d22"};">${esc(name)}</td>
      <td align="right" style="font-size:14px;font-weight:700;color:${color ?? "#1d1d22"};white-space:nowrap;">${money(amount)}</td>
    </tr></table>
    ${description ? `<div style="font-size:12.5px;color:#6b6b76;margin-top:3px;white-space:pre-line;">${esc(description)}</div>` : ""}
  </div>`;
}

/** Quote summary block: "prepared for" card, package + add-ons with
    descriptions, fees, discounts, Total Investment. Also the <quote_summary>
    merge tag in email templates. */
export function quoteSummaryHtml(bundle: EventBundle): string {
  const e = bundle.event;
  const fees = feeSummary(bundle);
  const clientName = e.client ? `${e.client.first_name} ${e.client.last_name}`.trim() : "";
  const times = [fmtTime(e.start_time), fmtTime(e.end_time)].filter(Boolean).join(" – ");

  const summaryCard = `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4fb;border-radius:12px;">
    <tr>
      <td style="padding:16px 18px;vertical-align:top;">
        <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8b6fd6;font-weight:800;">Prepared for</div>
        <div style="font-size:15px;font-weight:800;color:#1d1d22;margin-top:3px;">${esc(e.name || "Your Event")}</div>
        <div style="font-size:13px;color:#55555e;margin-top:2px;">${esc(clientName)}</div>
        <div style="font-size:13px;color:#55555e;">${fmtDate(e.event_date)}${times ? ` · ${times}` : ""}</div>
        ${e.venue?.name ? `<div style="font-size:13px;color:#55555e;">${esc(e.venue.name)}</div>` : ""}
      </td>
      <td align="right" style="padding:16px 18px;vertical-align:top;white-space:nowrap;">
        <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8b6fd6;font-weight:800;">Investment Total</div>
        <div style="font-size:24px;font-weight:900;color:#4b328e;margin-top:2px;">${money(fees.total)}</div>
      </td>
    </tr>
  </table>`;

  const packageSection = fees.packageLine
    ? `<div style="${SECTION_LABEL}">Your Package</div>${lineHtml(fees.packageLine.name, fees.packageLine.amount, fees.packageLine.description)}`
    : "";
  const addonSection = fees.addonLines.length
    ? `<div style="${SECTION_LABEL}">Add-Ons</div>${fees.addonLines.map((a) => lineHtml(a.name, a.amount, a.description)).join("")}`
    : "";
  const feeSection = fees.feeLines.length ? fees.feeLines.map((f) => lineHtml(f.name, f.amount)).join("") : "";
  const discountSection = fees.discountLines.length
    ? fees.discountLines.map((d) => lineHtml(d.name, -d.amount, null, "#1d7a46")).join("")
    : "";
  const totalRow = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:2px solid #4b328e;">
    <tr>
      <td style="padding:12px 0 0;font-size:16px;font-weight:900;color:#1d1d22;">Total Investment</td>
      <td align="right" style="padding:12px 0 0;font-size:20px;font-weight:900;color:#4b328e;">${money(fees.total)}</td>
    </tr>
  </table>`;

  return `${summaryCard}${packageSection}${addonSection}${feeSection}${discountSection}${totalRow}`;
}

/** Payment plan block — also the <payment_plan> merge tag in email templates. */
export function paymentPlanHtml(bundle: EventBundle): string {
  if (!bundle.schedule.length) return "";
  return `<div style="${SECTION_LABEL}">Payment Plan</div>
    ${bundle.schedule
      .map(
        (sp) => `<div style="${LINE_ROW}">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:13.5px;color:#1d1d22;font-weight:600;">${esc(sp.label || (sp.seq === 1 ? "Retainer" : `Payment ${sp.seq}`))}</td>
            <td style="font-size:12.5px;color:#6b6b76;">${sp.due_date ? fmtDate(sp.due_date) : "TBD"}</td>
            <td align="right" style="font-size:13.5px;font-weight:700;color:#1d1d22;white-space:nowrap;">${money(Number(sp.amount))}</td>
          </tr></table>
        </div>`
      )
      .join("")}`;
}

/** CTA button — also used when an email template attaches an e-sign document. */
export function signButtonHtml(buttonUrl: string, label: string): string {
  return `<div style="text-align:center;margin:28px 0 6px;">
    <a href="${buttonUrl}" style="display:inline-block;background:#4b328e;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:15px 40px;border-radius:12px;">${esc(label)}</a>
  </div>
  <p style="font-size:12px;color:#8a8a94;text-align:center;margin:14px 0 0;">If the button doesn't work, copy this link into your browser:<br/><a href="${buttonUrl}" style="color:#4b328e;word-break:break-all;">${buttonUrl}</a></p>`;
}

/** The quote-style email: greeting, event summary, package + add-ons with
    descriptions, Total Investment, payment plan, and the big CTA. */
export function agreementEmailHtml({
  bundle,
  docLabel,
  firstName,
  buttonUrl,
  companyName,
  intro,
  buttonLabel,
}: {
  bundle: EventBundle;
  docLabel: string;
  firstName: string;
  buttonUrl: string;
  companyName: string;
  intro?: string;
  buttonLabel?: string;
}): string {
  const content = `
  <div style="padding:30px;color:#2c2c33;font-size:15px;line-height:1.6;">
    <h1 style="margin:0 0 4px;font-size:22px;color:#1d1d22;">Hi ${esc(firstName)}, we can already picture you on the dance floor! 🎶</h1>
    <p style="margin:0 0 20px;color:#55555e;">${esc(intro ?? `Your ${docLabel} is ready — here's everything we've put together for your big day.`)}</p>
    ${quoteSummaryHtml(bundle)}
    ${paymentPlanHtml(bundle)}
    ${signButtonHtml(buttonUrl, buttonLabel ?? `Review & Sign ${docLabel}`)}
  </div>`;

  return emailShell(companyName, content);
}

/** Simple branded email (signed-copy confirmation etc.). */
export function signingEmailHtml({
  heading,
  bodyHtml,
  buttonLabel,
  buttonUrl,
  companyName,
}: {
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  companyName: string;
}): string {
  return emailShell(
    companyName,
    `<div style="padding:28px 30px;color:#2c2c33;font-size:15px;line-height:1.65;">
      <h1 style="margin:0 0 12px;font-size:21px;color:#1d1d22;">${heading}</h1>
      ${bodyHtml}
      <div style="text-align:center;margin:26px 0 8px;">
        <a href="${buttonUrl}" style="display:inline-block;background:#4b328e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 34px;border-radius:10px;">${buttonLabel}</a>
      </div>
      <p style="font-size:12px;color:#8a8a94;margin:18px 0 0;">If the button doesn't work, copy this link into your browser:<br/><a href="${buttonUrl}" style="color:#4b328e;word-break:break-all;">${buttonUrl}</a></p>
    </div>`
  );
}
