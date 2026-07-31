import "server-only";
import sanitizeHtml from "sanitize-html";

/* Server-side allowlist sanitizer for email HTML shown to PORTAL users (the
   couple). email_log.body_html is our own branded template output, but merge
   tags splice in client-supplied fields (names, org, notes…), so a crafted value
   could smuggle markup/script into the stored body. We render it with
   dangerouslySetInnerHTML in MyEventTab, so it must be sanitized before it ever
   reaches the browser.

   The allowlist keeps the tags/attributes real branded emails use — inline
   `style`, tables, links, the logo image — while dropping <script>/<style>/
   <iframe>, on* handlers, and javascript:/data: hrefs. CSS lives in inline
   style attributes (emailShell/brandWrap never emit <style> blocks), so allowing
   the style attribute preserves the look without opening a script vector
   (modern browsers don't execute expression()/javascript: inside CSS). */

const TABLE_ATTRS = ["width", "height", "align", "valign", "bgcolor", "border", "cellpadding", "cellspacing", "colspan", "rowspan", "nowrap"];

export function sanitizeEmailHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, {
    allowedTags: [
      "a", "b", "i", "u", "s", "em", "strong", "small", "sub", "sup", "mark",
      "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "center", "font",
      "img",
    ],
    allowedAttributes: {
      "*": ["style", "class", "align", "valign", "dir", "title", "width", "height", "bgcolor", "color"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      font: ["color", "face", "size"],
      table: TABLE_ATTRS,
      td: TABLE_ATTRS,
      th: TABLE_ATTRS,
      tr: TABLE_ATTRS,
      col: ["width", "span"],
      colgroup: ["width", "span"],
    },
    // Links + image sources: http(s)/mail/tel only — no javascript:/data:/vbscript:.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // Disallowed tags are dropped; <script>/<style> content is discarded entirely.
    disallowedTagsMode: "discard",
    // Harden every link that survives.
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }, true),
    },
  });
}
