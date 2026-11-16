import type { DocBlock } from "@/lib/documentBlocks";
import {
  XDOC_CSS,
  XDOC_DEFAULT_ACCENT,
  XDOC_DEFAULT_ACCENT_LIGHT,
} from "@/lib/documentShellCss";

/* The branded document shell — every generated document renders inside this.
   The builder only handles content; this owns the look (screen + print). */

export { XDOC_CSS, XDOC_DEFAULT_ACCENT, XDOC_DEFAULT_ACCENT_LIGHT };

export default function DocumentShell({
  title,
  docType,
  clientName,
  eventDateLabel,
  companyName,
  companyEmail,
  blocks,
  signedLine,
  logoUrl,
  accentColor,
  footerText,
}: {
  title: string;
  docType: string;
  clientName: string | null;
  eventDateLabel: string | null;
  companyName: string;
  companyEmail: string | null;
  blocks: DocBlock[];
  signedLine?: string | null;
  /** Optional override from company_settings.document_logo_url. */
  logoUrl?: string | null;
  /** Optional override from company_settings.document_accent_color. */
  accentColor?: string | null;
  /** Optional override from company_settings.document_footer_text. */
  footerText?: string | null;
}) {
  const accent = (accentColor ?? "").trim() || XDOC_DEFAULT_ACCENT;
  const styleVars = {
    ["--xdoc-accent" as string]: accent,
    ["--xdoc-accent-light" as string]: accent === XDOC_DEFAULT_ACCENT ? XDOC_DEFAULT_ACCENT_LIGHT : accent,
  };
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: XDOC_CSS }} />
      {/* chapters collapse on screen but must always print fully expanded */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.addEventListener('beforeprint',function(){document.querySelectorAll('details.xdoc-sec').forEach(function(d){d.dataset.wasOpen=d.open?'1':'';d.open=true;});});window.addEventListener('afterprint',function(){document.querySelectorAll('details.xdoc-sec').forEach(function(d){if(!d.dataset.wasOpen)d.open=false;});});`,
        }}
      />
      <div className="xdoc" style={styleVars}>
        <header className="xdoc-header">
          {/* the white logo — sits on the brand-gradient header and survives print */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={(logoUrl ?? "").trim() || "/logo-dark.png"} alt={companyName} />
          <div className="xdoc-kind">{docType}</div>
          <div className="xdoc-title">{title}</div>
          <div className="xdoc-sub">
            {[clientName, eventDateLabel].filter(Boolean).join(" · ")}
          </div>
        </header>
        <div className="xdoc-body">
          {blocks.map((b) => (
            <div key={b.id} className="xdoc-block" dangerouslySetInnerHTML={{ __html: b.html ?? "" }} />
          ))}
        </div>
        <footer className="xdoc-footer">
          <span>{(footerText ?? "").trim() || companyName}</span>
          <span>{signedLine ?? companyEmail ?? ""}</span>
        </footer>
      </div>
    </>
  );
}
