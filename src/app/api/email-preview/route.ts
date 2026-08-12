import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiModule } from "@/lib/apiAuth";
import { emailShell, signButtonHtml, appUrl } from "@/lib/signing";

// Sample values so the preview reads like a real send. Every key here is a tag the
// real renderer actually resolves (see supported_merge_tags() / render_merge_tags) —
// we deliberately do NOT sample tags the renderer drops, so unimplemented DJEP tags
// surface as red flags (see flagUnknownTags) instead of looking filled.
const SAMPLE: Record<string, string> = {
  first_name: "Jordan", last_name: "Rivera", client_name: "Jordan Rivera",
  client_email: "jordan@example.com", client_cell: "(555) 123-4567",
  client_organization: "Acme Co.", client_address: "123 Main St, Fort Lauderdale, FL",
  authorized_rep_name: "Jordan Rivera", authorized_rep_title: "Owner",
  authorized_rep_email: "jordan@example.com", authorized_rep_phone: "(555) 123-4567",
  decision_maker_name: "Jordan Rivera", decision_maker_phone: "(555) 123-4567",
  decision_maker_email: "jordan@example.com",
  poc_name: "Drew Ramos", poc_first_name: "Drew", poc_last_name: "Ramos",
  poc_email: "drew@xpressdjs.com", poc_phone: "(555) 010-2020",
  billing_terms: "Installments", legal_venue: "Broward County, Florida",
  djemployee1_stage_name: "DJ Drew", djemployee1_cell_phone: "(555) 234-5678",
  event_name: "Jordan & Taylor’s Wedding", event_type: "Wedding",
  event_date_long: "Saturday, August 15, 2026", event_date_short: "08/15/2026",
  event_date_countdown: "50", venue_name: "The Grand Ballroom",
  venue_address: "456 Ocean Dr, Miami, FL",
  event_location_manager: "Maria Gonzalez", event_location_cell_phone: "(305) 555-0199",
  event_location_comments: "Load-in via rear dock. Sound curfew 11 PM.",
  booking_comments: "Client prefers no line dancing. Grand entrance at 7:15 PM.",
  package_name: "Premier DJ Package", package_price: "$2,200.00",
  package_description: "Professional DJ/MC 6 Hours<br>Access to our Xpress DJ Planning Mobile App<br>Complete Sound System with Wireless Microphones<br>Simple Dance Floor Lighting",
  addon_list_no_prices: "2× Cold Spark Machines<br>360 Photo Booth<br>Uplighting",
  addon_list_line_breaks: "2× Cold Spark Machines — $500.00<br>360 Photo Booth — $800.00<br>Uplighting — $350.00",
  setup_time: "4:00 PM",
  start_time: "6:00 PM", end_time: "11:00 PM", guest_count: "150",
  // Kept internally consistent so the preview adds up: package $2,200 + add-ons
  // $1,650 − $500 discount = $3,350 total; $1,250 paid leaves $2,100 due. (Real
  // sends compute these from the event via render_merge_tags — illustrative only.)
  discount: "Discount (Venue Partner): -$500.00",
  addon_total_price: "$1,650.00",
  total_fee: "$3,350.00", balance_due: "$2,100.00", payments_received: "$1,250.00",
  deposit_value: "$500.00", retainer_amount: "$500.00", retainer_due_date: "August 1, 2026",
  second_payment_amount: "$1,250.00", second_payment_date: "September 1, 2026",
  third_payment_amount: "$1,350.00", third_payment_date_medium: "Oct 1, 2026",
  overtime_rate: "$150.00", current_date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  // Table tags render HTML — give the preview a representative sample so it isn't
  // swallowed by the browser as an unknown element (the real send fills this from
  // the event's assigned staff via render_merge_tags).
  employee_table4:
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Role</th>' +
    '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Stage Name</th>' +
    '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Phone</th>' +
    '</tr></thead><tbody>' +
    '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">DJ</td><td style="padding:6px 10px;border-bottom:1px solid #eee">DJ Drew</td><td style="padding:6px 10px;border-bottom:1px solid #eee">(555) 123-4567</td></tr>' +
    '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">MC</td><td style="padding:6px 10px;border-bottom:1px solid #eee">MC Alex</td><td style="padding:6px 10px;border-bottom:1px solid #eee">(555) 234-5678</td></tr>' +
    "</tbody></table>",
};

function applySample(text: string, companyName: string, supported: Set<string>, signature = ""): string {
  let out = (text || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Signature keys go before company_name so a <company_name> *inside* the
  // signature still resolves on the same pass.
  const map: Record<string, string> = {
    ...SAMPLE,
    company_email_signature: signature,
    email_signature: signature,
    company_name: companyName,
  };
  // Only fill tags the real renderer actually resolves. Unsupported tags are left
  // in place for flagUnknownTags() to mark in red, so the preview can never make an
  // unimplemented DJEP tag look filled.
  for (const [k, v] of Object.entries(map)) {
    if (!supported.has(k)) continue;
    out = out.split(`<${k}>`).join(v);
  }
  // <document_LABEL> tags attach files at send time — show a placeholder so the
  // preview doesn't swallow the (unknown) tag as an empty HTML element.
  out = out.replace(/<document_[a-z0-9_]+>/gi, '<em style="color:#8a8a94;">📎 (labeled files will be attached here)</em>');
  return out;
}

// One source of truth with the renderer: which <tags> the system actually resolves
// (render_merge_tags built-ins + CTA/set-password tags filled downstream + active
// custom tags). See supported_merge_tags() / migration 00175.
async function fetchSupportedTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Set<string>> {
  const { data } = await supabase.rpc("supported_merge_tags");
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ tag?: string } | string>) {
    const t = typeof row === "string" ? row : row?.tag;
    if (t) set.add(t.toLowerCase());
  }
  return set;
}

// Final pass, mirroring the renderer's strip. Any bare <tag> still present after
// sampling is either a supported field we had no sample for (shown muted — it fills
// from the event on a real send) or an UNIMPLEMENTED tag the renderer drops (flagged
// red, because enabling such a template ships blank sentences). Real HTML elements
// (<br>, <strong>, styled tags…) never look like an unknown merge tag, so they pass
// through untouched.
function flagUnknownTags(html: string, supported: Set<string>): string {
  return html.replace(/<([a-zA-Z][a-zA-Z0-9_]*)>/g, (full, tag: string) => {
    const key = tag.toLowerCase();
    if (supported.has(key)) {
      return `<span style="color:#8a8a94;" title="Fills from the event on a real send">‹${tag}›</span>`;
    }
    const looksLikeMergeTag = tag.includes("_") || key === "email" || key === "name" || key === "comments";
    if (!looksLikeMergeTag) return full; // real HTML element — leave untouched
    return (
      `<span style="background:#fdecec;color:#c0392b;border:1px solid #f5b7b1;border-radius:3px;` +
      `padding:0 4px;white-space:nowrap;font-weight:600;" ` +
      `title="This tag isn't supported — it will be blank in real sends. Remove it or use a supported tag.">` +
      `⚠ &lt;${tag}&gt;</span>`
    );
  });
}

// Interactive CTA tags (pay button/link, review-&-sign, journey start, e-sign
// link) are resolved from the event's pay/proposal token at real send time by
// enrichMessage() in lib/mailgun.ts. The preview has no real event, so render
// representative versions here — otherwise an unresolved <payment_button> is
// swallowed by the browser as an empty unknown element and the button "vanishes"
// even though real sends produce it. In SMS mode a button degrades to its URL,
// matching how the SMS pipeline flattens HTML.
function applyCtaTags(html: string, sms: boolean): string {
  const base = appUrl();
  const payUrl = `${base}/pay/sample`;
  const proposalUrl = `${base}/proposal/sample`;
  const button = (url: string, label: string) => (sms ? url : signButtonHtml(url, label));
  const replaceAll = (s: string, tag: string, value: string) => s.split(`<${tag}>`).join(value);

  let out = html;
  out = replaceAll(out, "payment_button", button(payUrl, "Pay Online"));
  out = replaceAll(out, "payment_link", payUrl);
  out = replaceAll(out, "review_sign_button", button(proposalUrl, "Review & Sign"));
  out = replaceAll(out, "review_sign_link", proposalUrl);
  out = replaceAll(out, "journey_start_button", button(proposalUrl, "Get Started"));
  out = replaceAll(out, "journey_start_link", proposalUrl);
  // (document_sign_link is already shown as a placeholder by the <document_*>
  //  rule in applySample.)
  // quote_summary / payment_plan build a table/list from the event at send time.
  out = replaceAll(out, "quote_summary", '<em style="color:#8a8a94;">(quote summary appears here)</em>');
  out = replaceAll(out, "payment_plan", '<em style="color:#8a8a94;">(payment schedule appears here)</em>');
  return out;
}

// Mirrors brandWrap() in lib/mailgun.ts so the preview matches a real send.
function brandWrap(html: string, companyName: string): string {
  if (/^\s*(<!doctype|<html)/i.test(html)) return html;
  const styled = html
    .replace(/<h1(?![^>]*style)/gi, '<h1 style="font-size:22px;color:#1d1d22;margin:0 0 10px;"')
    .replace(/<h2(?![^>]*style)/gi, '<h2 style="font-size:18px;color:#1d1d22;margin:18px 0 8px;"')
    .replace(/<h3(?![^>]*style)/gi, '<h3 style="font-size:16px;color:#1d1d22;margin:16px 0 6px;"')
    .replace(/<a (?![^>]*style)/gi, '<a style="color:#4b328e;" ')
    .replace(/<p(?![^>]*style)/gi, '<p style="margin:0 0 12px;"');
  return emailShell(
    companyName,
    `<div style="padding:28px 30px;color:#2c2c33;font-size:15px;line-height:1.6;font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;">${styled}</div>`
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  // Template preview lives under Settings → Email; gate on settings access
  // since /api/* skips the middleware RBAC gate.
  const denied = await requireApiModule("settings", "view", supabase);
  if (denied) return denied;

  const { body_html = "", subject = "", branded = true, sms = false } = await req.json();
  const { data: company } = await supabase
    .from("company_settings").select("company_name, email_signature_html").eq("id", true).maybeSingle();
  const companyName = company?.company_name ?? "Xpress Entertainment";
  const signature = company?.email_signature_html ?? "";
  const supported = await fetchSupportedTags(supabase);

  // applySample fills field tags; applyCtaTags renders the interactive buttons/
  // links; flagUnknownTags marks any tag the renderer would drop in red (body only —
  // never inject button/flag HTML into a subject line).
  const body = flagUnknownTags(applyCtaTags(applySample(body_html, companyName, supported, signature), sms), supported);
  let html: string;
  if (sms) {
    html = `<div style="background:#f4f2fa;padding:24px;font-family:ui-sans-serif,system-ui,Arial,sans-serif;">
      <div style="max-width:360px;margin:0 auto;background:#e9e7f3;border-radius:18px;padding:14px 16px;color:#1d1d22;font-size:15px;line-height:1.5;white-space:pre-wrap;">${body}</div>
    </div>`;
  } else if (branded) {
    html = brandWrap(body, companyName);
  } else {
    html = `<div style="padding:24px;font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#2c2c33;font-size:15px;line-height:1.6;">${body}</div>`;
  }

  // Subject is plain text — fill supported tags but don't inject flag HTML; an
  // unsupported tag stays visible as literal <tag> so the editor still sees it.
  return NextResponse.json({ html, subject: applySample(subject, companyName, supported) });
}
