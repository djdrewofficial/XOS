"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";

/* Compact light/dark toggle for the planner header. Shares the same mechanism as
   the staff ThemeToggle: flips `.dark` on <html> and persists to localStorage
   (the root layout's inline script restores it on load). */
export default function ThemeToggleIcon() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("xos-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle light / dark mode"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-brand dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-brand-lighter"
    >
      <FontAwesomeIcon icon={dark ? faSun : faMoon} />
    </button>
  );
}
