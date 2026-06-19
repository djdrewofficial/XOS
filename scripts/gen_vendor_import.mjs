// One-off: parse the DJEP vendor-contacts CSV export and emit an idempotent
// SQL import (vendors + vendor_contacts) into a numbered migration file.
import fs from "node:fs";

const CSV = "C:/Users/thedr/Downloads/24975_contacts.csv";
const OUT = "C:/Users/thedr/Projects/xos/supabase/migrations/00093_import_vendors.sql";

// ---- tiny CSV parser (quoted fields, embedded commas) ----
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(CSV, "utf8");
const rows = parseCsv(raw).filter((r) => r.some((c) => c.trim() !== ""));
const header = rows.shift();
const col = (r, name) => (r[header.indexOf(name)] ?? "").trim();

// ---- mappings ----
const CAT = {
  "Photographers": "cfe90f87-f3d1-4ec7-a453-fb47d51ff738",          // Photographer
  "Wedding Planner": "b583c923-9cb6-4778-99d6-3455da91850d",
  "Venue Contact / Coordinator": "cc5b0e00-cecc-42d5-9013-445224465721", // Venue Coordinator
  "Officiant": "cf8836c1-9fdd-4590-8a94-0a8e8e88e102",
  "Catering / Decor": "80478e1c-6012-4398-ae7b-4e50c369efb1",       // Caterer
  "Lighting / Equipment Rental": "752a1d1b-a92b-4ec9-86dd-8a842f8833b9", // Rentals
  "LED Robots": "6d55b975-3b8a-4e98-a7c0-5ebc7f47db52",             // Other
  "DJ / Entertainment Company": "6d55b975-3b8a-4e98-a7c0-5ebc7f47db52", // Other
};
function collab(v) {
  // tagging field — three states; "TBD"/blank stays undecided (null)
  if (/Yes - Invite to collab/i.test(v)) return "collab";
  if (/Tag Only/i.test(v)) return "tag";
  if (/NO Tag \/ NO Collab/i.test(v)) return "none";
  return null;
}
function normHandle(v) {
  if (!v) return null;
  let h = v.trim();
  h = h.replace(/^https?:\/\//i, "");                       // drop protocol
  h = h.replace(/^(www\.)?(instagram|tiktok)\.com\//i, ""); // drop domain (with or without protocol)
  h = h.replace(/[/?#].*$/, "").replace(/^@+/, "").trim();  // drop path/query, leading @
  return h ? `@${h}` : null;
}
function normWebsite(v) {
  if (!v) return null;
  let w = v.trim();
  if (!w) return null;
  if (!/^https?:\/\//i.test(w)) w = "https://" + w.replace(/^\/+/, "");
  return w;
}
// "12/30/2021" -> "2021-12-30" (the original date the contact was added in DJEP)
function isoDate(v) {
  const m = (v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
const isEmail = (v) => /@/.test(v) && !/\s/.test(v) && /\.[a-z]{2,}/i.test(v) && !/instagram\.com/i.test(v);
const isUrlish = (v) => /\.[a-z]{2,}/i.test(v) && !/@/.test(v);

// ---- build vendor groups keyed by normalized company name ----
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const groups = new Map();

for (const r of rows) {
  const company = col(r, "Company");
  const first = col(r, "First Name");
  const middle = col(r, "Middle Name");
  const last = col(r, "Last Name");
  const person = [first, middle, last].filter(Boolean).join(" ").trim();
  const companyName = company || person || "Unnamed Vendor";
  const key = norm(companyName);

  const emailRaw = col(r, "Email Address");
  const igRaw = col(r, "Instagram");
  let instagram = igRaw || null;
  let website = col(r, "Website URL") || null;
  let email = null;

  // recover data from fields where DJEP stashed the wrong thing:
  //  - a real email stays an email
  //  - an instagram URL in the email/ig slot becomes the instagram handle
  //  - any other URL becomes the website
  if (isEmail(emailRaw)) email = emailRaw;
  else if (/instagram\.com/i.test(emailRaw)) instagram = instagram || emailRaw;
  else if (isUrlish(emailRaw) && !website) website = emailRaw;
  if (instagram && /^https?:\/\//i.test(instagram) && !/instagram\.com/i.test(instagram)) {
    if (!website) website = instagram; // a non-IG URL parked in the IG column
    instagram = null;
  }
  instagram = normHandle(instagram);
  website = normWebsite(website);

  const phone = col(r, "Business Phone") || col(r, "Mobile Phone") || col(r, "Home Phone") || null;
  const role = col(r, "Job Title") || null;
  const added = isoDate(col(r, "Date Added"));

  let g = groups.get(key);
  if (!g) {
    g = {
      company_name: companyName,
      category_id: CAT[col(r, "Categories")] ?? null,
      website: website,
      instagram: instagram,
      tiktok: normHandle(col(r, "TikTok")),
      social_collab: collab(col(r, "Invite This Vendor to Collab?")),
      created_at: added,
      contacts: [],
    };
    groups.set(key, g);
  } else {
    // fill blanks on the shared vendor from later rows; keep earliest add date
    g.category_id ??= CAT[col(r, "Categories")] ?? null;
    g.website ??= website;
    g.instagram ??= instagram;
    g.tiktok ??= normHandle(col(r, "TikTok"));
    g.social_collab ??= collab(col(r, "Invite This Vendor to Collab?"));
    if (added && (!g.created_at || added < g.created_at)) g.created_at = added;
  }
  // a contact carries the phone/email (the vendor row has neither)
  const name = person || companyName;
  if (name || phone || email) {
    const dup = g.contacts.find((c) => c.name === name && c.phone === phone && c.email === email);
    if (!dup) g.contacts.push({ name, role, phone, email });
  }
}

// ---- emit SQL ----
const q = (v) => (v == null || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const qt = (v) => (v == null || v === "" ? "null::text" : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
out.push("-- XOS — import wedding-vendor directory from DJEP CSV export (24975_contacts).");
out.push("-- Grouped by company: one vendors row per company, one vendor_contacts row per");
out.push("-- person. Idempotent — skips a vendor that already exists (by name) and only");
out.push("-- adds contacts not already present, so it is safe to re-run.");
out.push("");
out.push("-- retire the deprecated 'either' tagging value (UI is now tag/collab/none)");
out.push("update vendors set social_collab = null where social_collab = 'either';");
out.push("");

let nVendors = 0, nContacts = 0;
for (const g of groups.values()) {
  nVendors++;
  nContacts += g.contacts.length;
  out.push(`-- ${g.company_name}`);
  out.push("with v as (");
  out.push("  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab, created_at)");
  out.push(`  select ${q(g.company_name)}, ${g.category_id ? q(g.category_id) + "::uuid" : "null"}, false, ${q(g.website)}, ${q(g.instagram)}, ${q(g.tiktok)}, ${q(g.social_collab)}, ${g.created_at ? q(g.created_at) + "::timestamptz" : "now()"}`);
  out.push(`  where not exists (select 1 from vendors where lower(company_name) = lower(${q(g.company_name)}))`);
  out.push("  returning id");
  out.push("), vid as (");
  out.push("  select id from v");
  out.push("  union all");
  out.push(`  select id from vendors where lower(company_name) = lower(${q(g.company_name)}) limit 1`);
  out.push(")");
  if (g.contacts.length) {
    out.push("insert into vendor_contacts (vendor_id, name, role, phone, email)");
    out.push("select (select id from vid limit 1), x.name, x.role, x.phone, x.email");
    out.push("from (values");
    out.push(
      g.contacts
        .map((c) => `  (${qt(c.name)}, ${qt(c.role)}, ${qt(c.phone)}, ${qt(c.email)})`)
        .join(",\n")
    );
    out.push(") as x(name, role, phone, email)");
    out.push("where not exists (");
    out.push("  select 1 from vendor_contacts vc");
    out.push("  where vc.vendor_id = (select id from vid limit 1)");
    out.push("    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')");
    out.push(");");
  } else {
    out.push("select 1 from vid;");
  }
  out.push("");
}

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`vendors=${nVendors} contacts=${nContacts} -> ${OUT}`);
