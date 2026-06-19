import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatComplete, isOpenAIConfigured } from "@/lib/openai";

/* Daily vendor matcher: for each vendor a couple added in the client app, ask
   GPT whether it matches an existing directory vendor (catching misspellings)
   and what info we already have that's missing on their entry. Writes review
   suggestions — never applies anything automatically. */

type Candidate = { id: string; name: string; category: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 1));

/** Cheap pre-rank so each GPT call only sees the most plausible candidates. */
function topCandidates(name: string, all: Candidate[], n = 40): Candidate[] {
  const t = tokens(name);
  const nn = norm(name);
  const scored = all.map((c) => {
    const ct = tokens(c.name);
    let overlap = 0;
    for (const x of t) if (ct.has(x)) overlap++;
    const sub = norm(c.name).includes(nn) || nn.includes(norm(c.name)) ? 2 : 0;
    return { c, score: overlap + sub };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, n).map((s) => s.c);
}

export async function runVendorMatching(admin: SupabaseClient, limit = 50): Promise<{ processed: number; suggestions: number }> {
  if (!isOpenAIConfigured()) return { processed: 0, suggestions: 0 };

  const { data: pending } = await admin
    .from("event_vendors")
    .select("id, event_id, vendor_id, contact_name, contact_phone, contact_email, vendor:vendors(company_name, category)")
    .is("match_checked_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (!pending?.length) return { processed: 0, suggestions: 0 };

  const { data: dir } = await admin.from("vendors").select("id, company_name, category");
  const candidates: Candidate[] = (dir ?? []).map((v) => ({ id: v.id, name: v.company_name, category: v.category ?? null }));

  let suggestionCount = 0;
  const checkedIds: string[] = [];

  for (const ev of pending) {
    checkedIds.push(ev.id);
    const v = (ev as unknown as { vendor: { company_name: string; category: string | null } | null }).vendor;
    const myName = v?.company_name ?? "";
    if (!myName) continue;

    // Don't offer the couple's own freshly-created row as a match.
    const pool = topCandidates(myName, candidates.filter((c) => c.id !== ev.vendor_id));
    const numbered = pool.map((c, i) => `${i + 1}. ${c.name}${c.category ? ` (${c.category})` : ""}`).join("\n");

    const system =
      "You match a newly-entered event vendor against an existing vendor directory for a DJ company. " +
      "Catch misspellings and near-duplicates. Respond ONLY with JSON: " +
      '{"match": <candidate number or null>, "corrected_name": <string or null>, "confidence": "high"|"medium"|"low", "reason": <short string>}. ' +
      "match = the directory entry that is the SAME business (even if misspelled). null if none. " +
      "corrected_name = a cleaned-up spelling of THEIR entry if it's clearly misspelled, else null.";
    const user =
      `New vendor entry: "${myName}"${v?.category ? ` — category ${v.category}` : ""}.\n\n` +
      (numbered ? `Existing directory candidates:\n${numbered}` : "No similar directory entries.");

    let parsed: { match: number | null; corrected_name: string | null; confidence?: string; reason?: string } | null = null;
    try {
      const raw = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }]);
      const txt = raw.trim().replace(/^```json?/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(txt);
    } catch {
      parsed = null;
    }
    if (!parsed) continue;

    const matched = parsed.match && parsed.match >= 1 && parsed.match <= pool.length ? pool[parsed.match - 1] : null;

    // What do we already have for the matched vendor that's missing on theirs?
    const proposed: Record<string, string> = {};
    if (parsed.corrected_name && norm(parsed.corrected_name) !== norm(myName)) proposed.corrected_name = parsed.corrected_name;
    if (matched) {
      proposed.matched_vendor_name = matched.name;
      const known = await bestKnownContact(admin, matched.id);
      if (!ev.contact_name && known.name) proposed.contact_name = known.name;
      if (!ev.contact_phone && known.phone) proposed.contact_phone = known.phone;
      if (!ev.contact_email && known.email) proposed.contact_email = known.email;
    }

    const hasFill = Object.keys(proposed).some((k) => k !== "matched_vendor_name");
    let kind: "merge" | "fill" | "duplicate" | null = null;
    if (matched) kind = "merge";
    else if (proposed.corrected_name) kind = "fill";
    if (!kind && !hasFill) continue; // nothing actionable

    const { error } = await admin.from("vendor_match_suggestions").insert({
      event_vendor_id: ev.id,
      event_id: ev.event_id,
      matched_vendor_id: matched?.id ?? null,
      kind: kind ?? "fill",
      confidence: parsed.confidence ?? null,
      rationale: parsed.reason ?? null,
      proposed,
    });
    if (!error) suggestionCount++;
  }

  if (checkedIds.length) {
    await admin.from("event_vendors").update({ match_checked_at: new Date().toISOString() }).in("id", checkedIds);
  }
  return { processed: checkedIds.length, suggestions: suggestionCount };
}

async function bestKnownContact(admin: SupabaseClient, vendorId: string): Promise<{ name: string | null; phone: string | null; email: string | null }> {
  const { data: vc } = await admin.from("vendor_contacts").select("name, phone, email").eq("vendor_id", vendorId).limit(1).maybeSingle();
  if (vc && (vc.name || vc.phone || vc.email)) return { name: vc.name ?? null, phone: vc.phone ?? null, email: vc.email ?? null };
  const { data: ev } = await admin
    .from("event_vendors")
    .select("contact_name, contact_phone, contact_email")
    .eq("vendor_id", vendorId)
    .or("contact_name.not.is.null,contact_phone.not.is.null,contact_email.not.is.null")
    .limit(1)
    .maybeSingle();
  return { name: ev?.contact_name ?? null, phone: ev?.contact_phone ?? null, email: ev?.contact_email ?? null };
}
