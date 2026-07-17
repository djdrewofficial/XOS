"use client";

import { useEffect, useRef } from "react";

/* Renders a staff-provided embed snippet (e.g. a HighLevel / Calendly booking
   widget). Setting innerHTML does NOT execute <script> tags, so we re-inject any
   external scripts as live elements — that's what lets widgets like HighLevel's
   form_embed.js auto-size their iframe. The snippet is admin-entered config, not
   client input, so it is trusted. */
export default function RawEmbed({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host || !html) return;
    host.innerHTML = html;

    const scripts = Array.from(host.querySelectorAll("script"));
    for (const old of scripts) {
      const s = document.createElement("script");
      for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
      s.text = old.textContent ?? "";
      old.replaceWith(s);
    }
    return () => {
      host.innerHTML = "";
    };
  }, [html]);

  // min-height so the widget has room before its script reports a size
  return <div ref={ref} style={{ minHeight: 640 }} />;
}
