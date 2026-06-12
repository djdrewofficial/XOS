"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/* DJEP parity: browser autocomplete is OFF by default across the app
   (General settings → Browser Settings re-enables it). Applies
   autocomplete="off" to every form on render and route change. */
export default function AutoCompleteControl({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (enabled) return; // browser default behavior
    const apply = () =>
      document.querySelectorAll("form:not([data-ac-off])").forEach((f) => {
        f.setAttribute("autocomplete", "off");
        f.setAttribute("data-ac-off", "1");
      });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, pathname]);

  return null;
}
