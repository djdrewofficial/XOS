import type { DocBlock } from "@/lib/documentBlocks";
import { XDOC_CSS } from "@/lib/documentShellCss";

export { XDOC_CSS };

/* The branded document shell — every generated document renders inside this.
   The builder only handles content; this owns the look (screen + print). */

export default function DocumentShell({
  title,
  docType,
  clientName,
  eventDateLabel,
  companyName,
  companyEmail,
  blocks,
  signedLine,
}: {
  title: string;
  docType: string;
  clientName: string | null;
  eventDateLabel: string | null;
  companyName: string;
  companyEmail: string | null;
  blocks: DocBlock[];
  signedLine?: string | null;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: XDOC_CSS }} />
      {/* chapters collapse on screen but must always print fully expanded */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.addEventListener('beforeprint',function(){document.querySelectorAll('details.xdoc-sec').forEach(function(d){d.dataset.wasOpen=d.open?'1':'';d.open=true;});});window.addEventListener('afterprint',function(){document.querySelectorAll('details.xdoc-sec').forEach(function(d){if(!d.dataset.wasOpen)d.open=false;});});`,
        }}
      />
      <div className="xdoc">
        <header className="xdoc-header">
          {/* the white logo — sits on the brand-gradient header and survives print */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt={companyName} />
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
          <span>{companyName}</span>
          <span>{signedLine ?? companyEmail ?? ""}</span>
        </footer>
      </div>
    </>
  );
}
