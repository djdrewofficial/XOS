import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiModule } from "@/lib/apiAuth";
import { emailShell } from "@/lib/signing";

// Sample values so the preview reads like a real send. Tags not listed here
// (incl. DJEP tags XOS doesn't support yet) stay visible as <tag> so the editor
// can still see what's unfilled.
const SAMPLE: Record<string, string> = {
  first_name: "Jordan", last_name: "Rivera", client_name: "Jordan Rivera",
  client_email: "jordan@example.com", client_cell: "(555) 123-4567",
  client_organization: "Acme Co.", client_address: "123 Main St, Fort Lauderdale, FL",
  salesperson_first_name: "Drew", djemployee_name: "Drew",
  email: "jordan@example.com", cell_phone: "(555) 123-4567",
  event_name: "Jordan & Taylor’s Wedding", event_type: "Wedding",
  event_date_long: "Saturday, August 15, 2026", event_date_short: "08/15/2026",
  event_date: "08/15/2026", event_date_medium: "Aug 15, 2026",
  event_date_countdown: "50", venue_name: "The Grand Ballroom",
  venue_address: "456 Ocean Dr, Miami, FL", event_location: "The Grand Ballroom",
  package_name: "Premier DJ Package", setup_time: "4:00 PM",
  start_time: "6:00 PM", end_time: "11:00 PM", guest_count: "150",
  total_fee: "$2,500.00", balance_due: "$1,250.00", payments_received: "$1,250.00",
  deposit_value: "$500.00", retainer_amount: "$500.00", retainer_due_date: "August 1, 2026",
  overtime_rate: "$150.00", current_date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
};

function applySample(text: string, companyName: string, signature = ""): string {
  let out = (text || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Signature keys go before company_name so a <company_name> *inside* the
  // signature still resolves on the same pass.
  const map: Record<string, string> = {
    ...SAMPLE,
    company_email_signature: signature,
    email_signature: signature,
    company_name: companyName,
  };
  for (const [k, v] of Object.entries(map)) out = out.split(`<${k}>`).join(v);
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

  const body = applySample(body_html, companyName, signature);
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

  return NextResponse.json({ html, subject: applySample(subject, companyName) });
}
