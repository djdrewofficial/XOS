/* Shared branded document CSS (plain TS for PDF scripts/tests). */

export const XDOC_CSS = `
.xdoc, .xdoc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.xdoc { max-width: 820px; margin: 0 auto; background: #fff; color: #1d1d22;
  font-family: Georgia, 'Times New Roman', serif; line-height: 1.65; font-size: 15px;
  border-radius: 14px; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,.12); }
.xdoc-header { background: linear-gradient(110deg, #4b328e 0%, #8b6fd6 100%); color: #fff;
  padding: 44px 52px 36px; font-family: ui-sans-serif, system-ui, sans-serif; }
.xdoc-header img { width: 190px; margin-bottom: 18px; }
.xdoc-kind { font-size: 11px; letter-spacing: .28em; text-transform: uppercase; opacity: .85; font-weight: 700; }
.xdoc-title { font-size: 30px; font-weight: 800; margin: 6px 0 4px; letter-spacing: -.01em; }
.xdoc-sub { font-size: 14px; opacity: .9; }
.xdoc-body { padding: 44px 52px; }
.xdoc-body h1, .xdoc-body h2, .xdoc-body h3 { font-family: ui-sans-serif, system-ui, sans-serif;
  color: #4b328e; letter-spacing: -.01em; margin: 1.6em 0 .5em; }
.xdoc-body h2 { font-size: 20px; } .xdoc-body h3 { font-size: 16px; }
.xdoc-body p { margin: .65em 0; }
.xdoc-body ul, .xdoc-body ol { padding-left: 1.4em; margin: .65em 0; }
.xdoc-body a { color: #4b328e; }
.xdoc-block { margin: 0 0 18px; }
.xdoc-block-heading { font-family: ui-sans-serif, system-ui, sans-serif; color: #4b328e;
  font-size: 16px; font-weight: 800; letter-spacing: -.01em; margin: 0.4em 0 0.35em; }
.xdoc-table { width: 100%; border-collapse: collapse; margin: 14px 0;
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
.xdoc-table th { background: #4b328e; color: #fff; text-align: left; padding: 9px 14px;
  font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
.xdoc-table td { padding: 10px 14px; border-bottom: 1px solid #ece9f4; vertical-align: top; }
.xdoc-table tfoot td { border-top: 2px solid #4b328e; border-bottom: none;
  font-weight: 800; font-size: 15px; background: #f6f4fb; }
.xdoc-amount { text-align: right; white-space: nowrap; }
.xdoc-qty { text-align: center; white-space: nowrap; width: 3.5em; }
.xdoc-desc { font-size: 12.5px; color: #6b6b76; margin-top: 3px; white-space: pre-line; }
.xdoc-discount td { color: #1d7a46; }
.xdoc-muted { color: #8a8a94; font-style: italic; }
.xdoc-summary { margin: 16px 0; padding: 14px 18px; border-radius: 12px;
  background: linear-gradient(135deg, #f6f4fb 0%, #efeafc 100%);
  border: 1px solid #ddd4f3; font-family: ui-sans-serif, system-ui, sans-serif; }
.xdoc-summary-row { display: flex; justify-content: space-between; gap: 16px;
  padding: 6px 0; font-size: 14px; font-weight: 600; color: #3a3a42; }
.xdoc-summary-row + .xdoc-summary-row { border-top: 1px solid #e4ddf4; }
.xdoc-summary-due { color: #4b328e; font-size: 15px; font-weight: 800; }
.xdoc-summary-paid { color: #1d7a46; font-size: 15px; font-weight: 800; }
.xdoc-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px; margin: 14px 0; font-family: ui-sans-serif, system-ui, sans-serif; }
.xdoc-detail { background: #f6f4fb; border-radius: 10px; padding: 10px 14px; }
.xdoc-detail-k { display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: .16em; color: #8b6fd6; font-weight: 800; }
.xdoc-detail-v { display: block; font-size: 14px; font-weight: 600; margin-top: 2px; }
.xdoc-divider { border: none; border-top: 2px solid #ece9f4; margin: 26px 0; }
/* collapsible chapters (Section blocks) — compact legal text, tap to expand */
.xdoc-sec { border: 1px solid #ece9f4; border-radius: 10px; margin: 0 0 10px; overflow: hidden; }
.xdoc-sec summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px;
  padding: 11px 16px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px;
  font-weight: 800; color: #4b328e; letter-spacing: .02em; background: #faf9fd; user-select: none; }
.xdoc-sec summary::-webkit-details-marker { display: none; }
.xdoc-sec summary::before { content: '▸'; font-size: 11px; color: #8b6fd6; transition: transform .15s; }
.xdoc-sec[open] summary::before { transform: rotate(90deg); }
.xdoc-sec[open] summary { border-bottom: 1px solid #ece9f4; }
.xdoc-sec-body { padding: 12px 16px; font-size: 13px; line-height: 1.55; color: #3a3a42; }
.xdoc-sec-body p { margin: .5em 0; }
.xdoc-sign { margin: 40px 0 8px; max-width: 360px; font-family: ui-sans-serif, system-ui, sans-serif; }
.xdoc-sign-line { border-bottom: 2px solid #1d1d22; height: 44px; }
.xdoc-sign-name { font-weight: 700; margin-top: 8px; }
.xdoc-sign-meta { font-size: 11px; text-transform: uppercase; letter-spacing: .14em; color: #8a8a94; }
.xdoc-signed { max-width: 420px; }
.xdoc-sign-script { font-family: 'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive;
  font-size: 32px; color: #1d1d22; border-bottom: 2px solid #1d1d22; padding: 6px 4px 10px; }
.xdoc-footer { padding: 22px 52px 30px; border-top: 1px solid #ece9f4; display: flex;
  justify-content: space-between; gap: 12px; font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px; color: #8a8a94; }
@media print {
  @page { margin: 0.45in; }
  html, body { background: #fff !important; }
  .xdoc { box-shadow: none; border-radius: 0; max-width: none; overflow: visible; }
  .xdoc-noprint { display: none !important; }
  .xdoc-header { border-radius: 0; padding: 34px 44px 28px; }
  .xdoc-body { padding: 32px 44px; }
  /* Tall tables must split across pages (repeat thead). Avoid blank page-1 gaps.
     Keep compact cards/boxes and individual rows together; keep doc footer with prior content. */
  .xdoc-table { break-inside: auto; page-break-inside: auto; }
  .xdoc-table thead { display: table-header-group; }
  .xdoc-table tfoot { display: table-row-group; } /* total stays at end of table, not every page */
  .xdoc-table tr { break-inside: avoid; page-break-inside: avoid; }
  .xdoc-details, .xdoc-sign, .xdoc-detail, .xdoc-summary { break-inside: avoid; page-break-inside: avoid; }
  .xdoc-sec { border: none; border-radius: 0; }
  .xdoc-sec summary { background: none; padding: 8px 0 2px; }
  .xdoc-sec summary::before { display: none; }
  .xdoc-sec-body { padding: 4px 0 10px; }
  .xdoc-body h1, .xdoc-body h2, .xdoc-body h3, .xdoc-block-heading { break-after: avoid; page-break-after: avoid; }
  .xdoc-divider { break-after: avoid; }
  .xdoc-footer { border-top: 1px solid #ece9f4; break-before: avoid; page-break-before: avoid; }
}
`;
