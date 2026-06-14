"use client";

import { createContext, useContext, useState } from "react";

/* Shared open/close state for the mobile nav drawer — the hamburger lives in
   TopBar, the drawer is the Sidebar, so they coordinate through this context.
   No effect on desktop (md+), where the sidebar is always visible. */

const MobileNavCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MobileNavCtx.Provider value={{ open, setOpen }}>{children}</MobileNavCtx.Provider>;
}

export const useMobileNav = () => useContext(MobileNavCtx);
