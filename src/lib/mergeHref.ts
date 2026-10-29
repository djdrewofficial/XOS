/* Merge tags used as link hrefs.
   The rich-text editor stores <tag> inside an attribute as &lt;tag&gt;, and a
   pasted URL can also be percent-encoded as %3Ctag%3E. render_merge_tags (SQL)
   decodes both, fills the tag, then keeps only safe absolute hrefs.
   Keep xos_safe_href / xos_sanitize_href_attrs in migration 00202 in sync.
   <vibo_link> and legacy <custom_field7> are filled from events.custom_fields.vibo_link
   in migration 00203, then these same href rules apply. */

const MERGE_TAG_BODY = "([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*)";
const MERGE_TAG_FORMS = [
  new RegExp(`^<${MERGE_TAG_BODY}>$`),
  new RegExp(`^&lt;${MERGE_TAG_BODY}&gt;$`, "i"),
  new RegExp(`^%3C${MERGE_TAG_BODY}%3E$`, "i"),
];

/** Tag name when the whole string is one merge tag, in any stored form. */
export function mergeTagName(value: string): string | null {
  const t = (value ?? "").trim();
  for (const form of MERGE_TAG_FORMS) {
    const m = t.match(form);
    if (m) return m[1];
  }
  return null;
}

/** Turn editor-stored tag delimiters into raw <tag> so a later replace can see them.
    Only underscore tokens: %3Cscript%3E must not become a real <script> element. */
export function decodeMergeTagDelimiters(html: string): string {
  return (html ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(new RegExp(`%3C${MERGE_TAG_BODY}%3E`, "gi"), "<$1>");
}

function unescapeAttr(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A URL safe to put in an href, already attribute-escaped, or "" when it is not. */
export function safeHref(raw: string): string {
  let v = (raw ?? "").replace(/[\u0000-\u001F\u007F]/g, "");
  v = v.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, "");
  if (!v) return "";
  if (/[\s\u00a0<>"'\\]/.test(v) || v.includes("&#")) return "";
  if (v.startsWith("//")) return "";

  if (v.includes(":")) {
    const scheme = v.slice(0, v.indexOf(":")).toLowerCase();
    if (scheme !== "http" && scheme !== "https" && scheme !== "mailto" && scheme !== "tel") return "";
  } else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([:/?#].*)?$/i.test(v)) {
    v = `https://${v}`;
  } else {
    return "";
  }
  return escapeAttr(v);
}

/** True when the link dialog may store this href (a safe URL, or a whole merge tag). */
export function isAllowedEditorHref(href: string): boolean {
  const t = (href ?? "").trim();
  if (!t) return false;
  if (mergeTagName(t)) return true;
  return safeHref(t) !== "";
}

/** Rewrite every href="..." . Unsafe, empty, and relative values lose the attribute.
    A still-unresolved <tag_name> is left in place when preserveMergeTags is set,
    so a later pass (payment link, set-password link) can fill it. */
export function sanitizeHrefAttributes(html: string, opts?: { preserveMergeTags?: boolean }): string {
  const preserve = opts?.preserveMergeTags !== false;
  const src = html ?? "";
  if (!src) return "";
  let out = "";
  let i = 0;
  const lower = src.toLowerCase();
  while (i < src.length) {
    const rel = lower.indexOf('href="', i);
    if (rel === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, rel);
    const valueStart = rel + 'href="'.length;
    const end = src.indexOf('"', valueStart);
    if (end === -1) {
      out += src.slice(rel);
      break;
    }
    const raw = src.slice(valueStart, end);
    if (preserve && mergeTagName(raw)) {
      out += src.slice(rel, end + 1);
    } else {
      const safe = safeHref(unescapeAttr(raw));
      if (safe) out += `href="${safe}"`;
    }
    i = end + 1;
  }
  return out;
}
