"use client";

import { useEffect, useState } from "react";

/**
 * Live search over server-rendered content: filters any element marked
 * data-searchable inside the target container by its text content.
 */
export default function LiveFilter({
  targetSelector,
  placeholder,
}: {
  targetSelector: string;
  placeholder: string;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const needle = q.trim().toLowerCase();
    const els = document.querySelectorAll<HTMLElement>(`${targetSelector} [data-searchable]`);
    els.forEach((el) => {
      const hit = !needle || (el.textContent ?? "").toLowerCase().includes(needle);
      el.style.display = hit ? "" : "none";
    });
    // hide group sections that have no visible rows
    const groups = document.querySelectorAll<HTMLElement>(`${targetSelector} [data-search-group]`);
    groups.forEach((g) => {
      const rows = g.querySelectorAll<HTMLElement>("[data-searchable]");
      const anyVisible = [...rows].some((r) => r.style.display !== "none");
      g.style.display = rows.length === 0 || anyVisible ? "" : "none";
    });
  }, [q, targetSelector]);

  return (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={placeholder}
      className="input w-full max-w-md px-4 py-2.5"
    />
  );
}
