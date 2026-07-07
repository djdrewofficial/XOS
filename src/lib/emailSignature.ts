/* Structured email-signature builder. The Settings UI edits a SignatureConfig
   (toggles + values); this module turns it into email-safe HTML. The generated
   HTML is stored in company_settings.email_signature_html and dropped into
   emails wherever the <company_email_signature> merge tag appears (resolved in
   SQL — migration 00110). Keep this file dependency-free so both the client
   builder (live preview) and the server action can call renderSignatureHtml. */

export type SignatureConfig = {
  logoSize: "s" | "m" | "l";
  align: "left" | "center";
  divider: boolean;
  showWebsite: boolean;
  website: string;
  showEmail: boolean;
  email: string;
  showPhone: boolean;
  phone: string;
  showSocial: boolean;
  instagram: string;
  tiktok: string;
};

export const defaultSignatureConfig: SignatureConfig = {
  logoSize: "m",
  align: "left",
  divider: true,
  showWebsite: true,
  website: "xpressdjs.com",
  showEmail: true,
  email: "events@xpressdjs.com",
  showPhone: false,
  phone: "",
  showSocial: false,
  instagram: "",
  tiktok: "",
};

/** Merge a possibly-partial/untrusted stored config onto the defaults. */
export function normalizeSignatureConfig(input: unknown): SignatureConfig {
  const c = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const size = c.logoSize === "s" || c.logoSize === "l" ? c.logoSize : "m";
  return {
    logoSize: size,
    align: c.align === "center" ? "center" : "left",
    divider: bool(c.divider, defaultSignatureConfig.divider),
    showWebsite: bool(c.showWebsite, defaultSignatureConfig.showWebsite),
    website: str(c.website, defaultSignatureConfig.website),
    showEmail: bool(c.showEmail, defaultSignatureConfig.showEmail),
    email: str(c.email, defaultSignatureConfig.email),
    showPhone: bool(c.showPhone, defaultSignatureConfig.showPhone),
    phone: str(c.phone, ""),
    showSocial: bool(c.showSocial, defaultSignatureConfig.showSocial),
    instagram: str(c.instagram, ""),
    tiktok: str(c.tiktok, ""),
  };
}

// XOS-hosted brand assets. Stored signature HTML ships to real inboxes, so the
// logo must use an absolute production URL (never localhost from a dev save).
const LOGO_ORIGIN = "https://xos.xpressdjs.com";
const LOGO_WIDTH: Record<SignatureConfig["logoSize"], number> = { s: 130, m: 180, l: 230 };
const LINK = "#4b328e";
const FONT = "font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;";

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function normUrl(u: string): string {
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
function stripScheme(u: string): string {
  return u.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** How to render. "email" = the stored HTML: light inline colors plus a scoped
    dark-mode <style> so links/text flip to white and the logo swaps in dark
    inboxes. "previewLight"/"previewDark" bake the colors in directly so the
    builder can simulate either mode (media queries can't be toggled by JS). */
export type SignatureRenderMode = "email" | "previewLight" | "previewDark";

/** Build the email-safe signature HTML from a config. Table + inline styles for
    client compatibility; the logo, links, and contact text all switch to their
    white/light variants in dark-mode inboxes so nothing disappears. */
export function renderSignatureHtml(cfg: SignatureConfig, mode: SignatureRenderMode = "email"): string {
  const dark = mode === "previewDark";
  const w = LOGO_WIDTH[cfg.logoSize] ?? LOGO_WIDTH.m;
  const align = cfg.align === "center" ? "center" : "left";
  const centerImg = align === "center" ? "margin-left:auto;margin-right:auto;" : "";

  const link = dark ? "#ffffff" : LINK;
  const muted = dark ? "#ffffff" : "#8a8a94";
  const dividerColor = dark ? "#3a3746" : "#e8e4f3";

  const logo =
    mode === "email"
      ? `<picture>` +
        `<source srcset="${LOGO_ORIGIN}/logo-dark.png" media="(prefers-color-scheme: dark)">` +
        `<img src="${LOGO_ORIGIN}/logo-light.png" alt="Xpress Entertainment" width="${w}" ` +
        `style="display:block;width:${w}px;max-width:${w}px;height:auto;border:0;${centerImg}" /></picture>`
      : `<img src="${LOGO_ORIGIN}/logo-${dark ? "dark" : "light"}.png" alt="Xpress Entertainment" width="${w}" ` +
        `style="display:block;width:${w}px;max-width:${w}px;height:auto;border:0;${centerImg}" />`;

  const contact: string[] = [];
  if (cfg.showWebsite && cfg.website.trim())
    contact.push(`<a href="${esc(normUrl(cfg.website))}" style="color:${link};text-decoration:none;">${esc(stripScheme(cfg.website))}</a>`);
  if (cfg.showEmail && cfg.email.trim())
    contact.push(`<a href="mailto:${esc(cfg.email.trim())}" style="color:${link};text-decoration:none;">${esc(cfg.email.trim())}</a>`);
  if (cfg.showPhone && cfg.phone.trim())
    contact.push(`<a href="tel:${esc(cfg.phone.replace(/[^0-9+]/g, ""))}" style="color:${link};text-decoration:none;">${esc(cfg.phone.trim())}</a>`);
  const contactRow = contact.length
    ? `<div class="m" style="margin-top:11px;${FONT}font-size:13px;color:${muted};line-height:1.6;">${contact.join(" &nbsp;&middot;&nbsp; ")}</div>`
    : "";

  const social: string[] = [];
  if (cfg.showSocial && cfg.instagram.trim())
    social.push(`<a href="${esc(normUrl(cfg.instagram))}" style="color:${link};text-decoration:none;font-weight:600;">Instagram</a>`);
  if (cfg.showSocial && cfg.tiktok.trim())
    social.push(`<a href="${esc(normUrl(cfg.tiktok))}" style="color:${link};text-decoration:none;font-weight:600;">TikTok</a>`);
  const socialRow = social.length
    ? `<div class="m" style="margin-top:7px;${FONT}font-size:13px;color:${muted};">${social.join(" &nbsp;&middot;&nbsp; ")}</div>`
    : "";

  const divider = cfg.divider ? `padding-top:14px;border-top:1px solid ${dividerColor};` : "";
  const tableMargin = align === "center" ? "margin-left:auto;margin-right:auto;" : "";

  // Only the stored email HTML carries the media query; previews bake colors in.
  const darkStyle =
    mode === "email"
      ? `<style>@media (prefers-color-scheme:dark){.xsig a{color:#ffffff !important}.xsig .m{color:#ffffff !important}.xsig .d{border-color:#3a3746 !important}}</style>`
      : "";

  return (
    `${darkStyle}<table class="xsig" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px;${tableMargin}">` +
    `<tr><td class="d" style="${divider}text-align:${align};">${logo}${contactRow}${socialRow}</td></tr></table>`
  );
}
