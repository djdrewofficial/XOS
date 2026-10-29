import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeMergeTagDelimiters,
  isAllowedEditorHref,
  mergeTagName,
  safeHref,
  sanitizeHrefAttributes,
} from "./mergeHref.ts";

const GALLERY = "https://gallery.example.com/a?x=1&y=2";
const GALLERY_ATTR = "https://gallery.example.com/a?x=1&amp;y=2";

describe("decodeMergeTagDelimiters", () => {
  it("decodes entity-encoded and percent-encoded merge tags", () => {
    assert.equal(
      decodeMergeTagDelimiters('<a href="&lt;custom_field9&gt;">CLICK HERE</a>'),
      '<a href="<custom_field9>">CLICK HERE</a>',
    );
    assert.equal(
      decodeMergeTagDelimiters('<a href="%3Ccustom_field9%3E">CLICK HERE</a>'),
      '<a href="<custom_field9>">CLICK HERE</a>',
    );
    assert.equal(
      decodeMergeTagDelimiters('<a href="%3cphotobooth_gallery%3e">x</a>'),
      '<a href="<photobooth_gallery>">x</a>',
    );
    assert.equal(decodeMergeTagDelimiters("Hi &lt;first_name&gt;,"), "Hi <first_name>,");
  });

  it("does not turn %3Cscript%3E into a script tag", () => {
    const html = '<p>%3Cscript%3Ealert(1)%3C/script%3E</p>';
    assert.equal(decodeMergeTagDelimiters(html), html);
  });
});

describe("safeHref", () => {
  it("keeps absolute http(s), mailto, and tel, and escapes ampersands", () => {
    assert.equal(safeHref(GALLERY), GALLERY_ATTR);
    assert.equal(safeHref("http://example.com/x"), "http://example.com/x");
    assert.equal(safeHref("mailto:guest@example.com"), "mailto:guest@example.com");
    assert.equal(safeHref("tel:+15551212"), "tel:+15551212");
    assert.equal(safeHref("  https://example.com/a  "), "https://example.com/a");
  });

  it("prefixes https on a bare hostname", () => {
    assert.equal(safeHref("www.example.com/gallery"), "https://www.example.com/gallery");
    assert.equal(safeHref("gallery.example.com/a?b=1&c=2"), "https://gallery.example.com/a?b=1&amp;c=2");
  });

  it("rejects empty, relative, and non-URL text", () => {
    assert.equal(safeHref(""), "");
    assert.equal(safeHref("   "), "");
    assert.equal(safeHref("Erick"), "");
    assert.equal(safeHref("/gallery/abc"), "");
    assert.equal(safeHref("//evil.example/phish"), "");
    assert.equal(safeHref("#"), "");
  });

  it("rejects javascript, data, and vbscript, including disguised forms", () => {
    assert.equal(safeHref("javascript:alert(1)"), "");
    assert.equal(safeHref("JAVASCRIPT:alert(1)"), "");
    assert.equal(safeHref(" javascript:alert(1)"), "");
    assert.equal(safeHref("java\tscript:alert(1)"), "");
    assert.equal(safeHref("java\nscript:alert(1)"), "");
    assert.equal(safeHref("data:text/html,hi"), "");
    assert.equal(safeHref("vbscript:msgbox(1)"), "");
    assert.equal(safeHref("&#106;avascript:alert(1)"), "");
    assert.equal(safeHref("javascript&#58;alert(1)"), "");
  });

  it("rejects values that can break out of the attribute", () => {
    assert.equal(safeHref('https://ok.example/" onclick="alert(1)'), "");
    assert.equal(safeHref("https://ok.example/'onclick='alert(1)"), "");
    assert.equal(safeHref("https://ok.example/<script>"), "");
    assert.equal(safeHref("https://ok.example/a\\b"), "");
  });
});

describe("sanitizeHrefAttributes", () => {
  it("resolves a substituted gallery tag into a working absolute href", () => {
    const stored = '👉 <a target="_blank" rel="noopener noreferrer nofollow" href="&lt;custom_field9&gt;"><strong>CLICK HERE</strong></a>';
    const decoded = decodeMergeTagDelimiters(stored);
    const filled = decoded.replaceAll("<custom_field9>", GALLERY);
    const out = sanitizeHrefAttributes(filled);
    assert.match(out, new RegExp(`href="${GALLERY_ATTR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.doesNotMatch(out, /custom_field9|javascript:/i);
    assert.match(out, /CLICK HERE/);
  });

  it("resolves a plain <tag> and a percent-encoded tag the same way", () => {
    for (const href of ["<photobooth_gallery>", "%3Cphotobooth_gallery%3E", "&lt;photobooth_gallery&gt;"]) {
      const decoded = decodeMergeTagDelimiters(`<a href="${href}">CLICK HERE</a>`);
      const filled = decoded.replaceAll("<photobooth_gallery>", "https://photos.example/e");
      assert.equal(
        sanitizeHrefAttributes(filled),
        '<a href="https://photos.example/e">CLICK HERE</a>',
      );
    }
  });

  it("drops an empty or non-URL href and leaves the link text", () => {
    assert.equal(sanitizeHrefAttributes('<a href="">CLICK HERE</a>'), "<a >CLICK HERE</a>");
    assert.equal(sanitizeHrefAttributes('<a href="Erick">CLICK HERE</a>'), "<a >CLICK HERE</a>");
    assert.equal(
      sanitizeHrefAttributes('<a target="_blank" href="javascript:alert(1)"><strong>CLICK HERE</strong></a>'),
      '<a target="_blank" ><strong>CLICK HERE</strong></a>',
    );
  });

  it("keeps a still-unresolved merge tag when asked, and drops it otherwise", () => {
    const html = '<a href="<payment_link>">Pay</a>';
    assert.equal(sanitizeHrefAttributes(html, { preserveMergeTags: true }), html);
    assert.equal(sanitizeHrefAttributes(html, { preserveMergeTags: false }), "<a >Pay</a>");
    assert.equal(
      sanitizeHrefAttributes('<a href="&lt;payment_link&gt;">Pay</a>', { preserveMergeTags: true }),
      '<a href="&lt;payment_link&gt;">Pay</a>',
    );
    assert.equal(
      sanitizeHrefAttributes('<a href="%3Cpayment_link%3E">Pay</a>', { preserveMergeTags: true }),
      '<a href="%3Cpayment_link%3E">Pay</a>',
    );
  });

  it("leaves a normal https href intact, including an escaped query", () => {
    const html = '<a href="https://play.google.com/store/apps/details?id=com.example&amp;hl=en_US">App</a>';
    assert.equal(sanitizeHrefAttributes(html), html);
  });

  it("does not let an escaped quote break out of the attribute", () => {
    const html = '<a href="https://ok.example/&quot; onclick=&quot;alert(1)">x</a>';
    assert.equal(sanitizeHrefAttributes(html), "<a >x</a>");
  });
});

describe("isAllowedEditorHref", () => {
  it("allows a merge tag in each stored form and a real URL", () => {
    assert.equal(mergeTagName("<custom_field9>"), "custom_field9");
    assert.equal(isAllowedEditorHref("<photobooth_gallery>"), true);
    assert.equal(isAllowedEditorHref("&lt;photobooth_gallery&gt;"), true);
    assert.equal(isAllowedEditorHref("%3Cphotobooth_gallery%3E"), true);
    assert.equal(isAllowedEditorHref("https://photos.example/e"), true);
    assert.equal(isAllowedEditorHref("www.photos.example/e"), true);
  });

  it("rejects javascript and an empty href", () => {
    assert.equal(isAllowedEditorHref(""), false);
    assert.equal(isAllowedEditorHref("javascript:alert(1)"), false);
    assert.equal(isAllowedEditorHref("<script>"), false);
    assert.equal(isAllowedEditorHref("%3Cscript%3E"), false);
  });
});
