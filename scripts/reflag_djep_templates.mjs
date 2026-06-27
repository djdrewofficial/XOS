import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const readEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const supabase = createClient(readEnv("NEXT_PUBLIC_SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// ---- read DJEP xls ----
const buf = fs.readFileSync("C:/Users/thedr/Downloads/24975_email_templates.xls");
let raw; try { raw = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { raw = new TextDecoder("windows-1252").decode(buf); }
const rows = [...raw.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
const H = rows[0].map((x) => x.replace(/<[^>]+>/g, "").trim());
const col = (r, n) => r[H.indexOf(n)] ?? "";
const txt = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

const ANCHOR = { "Event Date": 1, "Date Booked": 1, "Initial Contact Date": 1, "Contract Sent Date": 1, "Contract Due Date": 1, "Contract Signed Date": 1, "Quote Sent": 1 };

// XOS-supported merge tags (render_merge_tags v6 + documented send-pipeline tags)
const SUPPORTED = new Set(["first_name","last_name","client_name","client_email","client_cell","client_organization","client_address","authorized_rep_name","authorized_rep_title","authorized_rep_email","authorized_rep_phone","event_name","event_type","event_date_long","event_date_short","event_date_countdown","venue_name","venue_address","package_name","setup_time","guest_count","decision_maker_name","decision_maker_phone","decision_maker_email","billing_terms","total_fee","payments_received","balance_due","deposit_value","retainer_amount","retainer_due_date","overtime_rate","start_time","end_time","company_name","company_email_signature","email_signature","legal_venue","current_date","document_sign_link","quote_summary","payment_plan"]);

// HTML elements that match the <word> shape — not merge tags
const HTML = new Set(["html","head","body","title","style","script","meta","link","p","br","hr","b","i","u","em","strong","span","div","a","ul","ol","li","table","thead","tbody","tfoot","tr","td","th","h1","h2","h3","h4","h5","h6","img","blockquote","pre","code","sub","sup","small","center","font","section","header","footer","nav","article","aside","main","figure","figcaption","caption","col","colgroup","label","button","address","abbr","mark","del","ins","kbd","samp","var","wbr","dl","dt","dd","s","q","cite","time","picture","source","video","audio","iframe","fieldset","legend","form","input","select","option","textarea","big","tt","strike","u"]);

const data = rows.slice(1);
let updated = 0, depFlags = 0, attachFlags = 0;
for (const r of data) {
  const id = parseInt(txt(col(r, "Template ID")), 10);
  const isSms = txt(col(r, "Is SMS")) === "True";
  const body = col(r, "Content (Body of Email)") || "";
  const reasons = [];

  // truncated body — the DJEP report export caps "Content" at 1000 chars,
  // so longer emails (esp. full-HTML ones) are cut off mid-document.
  if (body.length >= 1000) reasons.push(`Body was cut off at 1000 characters by the DJEP export — re-import the full email content before using.`);

  // anchor (re-derive to keep the row's full reason set)
  const de = txt(col(r, "Date Element"));
  if (de && !ANCHOR[de]) reasons.push(`Imported timing anchor “${de}” has no XOS equivalent — pick a send trigger before enabling.`);

  // unsupported merge tags
  const tags = [...body.matchAll(/<([a-z][a-z0-9_]*)>/g)].map((m) => m[1]);
  const missing = [...new Set(tags.filter((t) => !HTML.has(t) && !SUPPORTED.has(t)))];
  if (missing.length) {
    depFlags++;
    const shown = missing.slice(0, 6).map((t) => `<${t}>`).join(", ");
    reasons.push(`Uses merge tags XOS doesn’t support yet: ${shown}${missing.length > 6 ? ` +${missing.length - 6} more` : ""}. Add them to render_merge_tags or edit the copy.`);
  }

  // attached DJEP document
  const att = txt(col(r, "Autofill Attachment"));
  if (att && att !== "0") {
    attachFlags++;
    reasons.push(`Attached a DJEP document (#${att}) that doesn’t exist in XOS — attach the matching XOS document, or remove.`);
  }

  void isSms;
  const { error } = await supabase.from("email_templates").update({ review_reasons: reasons }).eq("legacy_djep_id", id);
  if (error) { console.error("FAIL", id, error.message); process.exit(1); }
  updated++;
}
console.log("updated:", updated, "| with merge-tag gaps:", depFlags, "| with missing attachments:", attachFlags);

const { count } = await supabase.from("email_templates").select("*", { count: "exact", head: true }).neq("review_reasons", "{}").not("legacy_djep_id", "is", null);
console.log("imported templates now flagged (any reason):", count);
