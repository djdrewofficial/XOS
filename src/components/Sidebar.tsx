"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faGauge,
  faCalendarDays,
  faCalendarPlus,
  faUsers,
  faBuilding,
  faHandshake,
  faBoxOpen,
  faSliders,
  faUserGroup,
  faMoneyBillWave,
  faGear,
  faBolt,
  faTableColumns,
  faListCheck,
  faCircleHalfStroke,
  faIdBadge,
  faFileSignature,
  faCreditCard,
  faReceipt,
  faPenToSquare,
  faEnvelope,
  faBullseye,
  faPowerOff,
} from "@fortawesome/free-solid-svg-icons";

type NavItem = { href: string; label: string; icon: IconDefinition };
type NavGroup = { group: string; icon: IconDefinition; items: NavItem[] };
type Entry = NavItem | NavGroup;
const isGroup = (e: Entry): e is NavGroup => "group" in e;

const SECTIONS: { heading: string; items: Entry[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: faGauge },
      { href: "/events", label: "Events", icon: faCalendarDays },
      { href: "/events/new", label: "Add Event", icon: faCalendarPlus },
      { href: "/clients", label: "Clients", icon: faUsers },
      { href: "/documents", label: "Documents", icon: faFileSignature },
    ],
  },
  {
    heading: "Directory",
    items: [
      { href: "/venues", label: "Venues", icon: faBuilding },
      { href: "/vendors", label: "Vendors", icon: faHandshake },
      { href: "/packages", label: "Packages", icon: faBoxOpen },
      { href: "/equipment", label: "Equipment", icon: faSliders },
      { href: "/employees", label: "Employees", icon: faUserGroup },
    ],
  },
  {
    heading: "Money",
    items: [{ href: "/payments", label: "Payments", icon: faMoneyBillWave }],
  },
  {
    heading: "XOS Settings",
    items: [
      {
        group: "Application",
        icon: faGear,
        items: [
          { href: "/settings/general", label: "General", icon: faGear },
          { href: "/settings/helpers", label: "Booking Helpers", icon: faBolt },
          { href: "/settings/dashboard", label: "Dashboard Layout", icon: faTableColumns },
          { href: "/events?settings=1", label: "Event List Settings", icon: faListCheck },
          { href: "/settings/statuses", label: "Event Statuses", icon: faCircleHalfStroke },
          { href: "/settings/staff", label: "Staff Settings", icon: faIdBadge },
          { href: "/settings/payment-settings", label: "Payment Settings", icon: faCreditCard },
          { href: "/settings/expenses", label: "Expenses", icon: faReceipt },
          { href: "/settings/custom-fields", label: "Custom Fields", icon: faPenToSquare },
        ],
      },
      { href: "/settings/email", label: "Email", icon: faEnvelope },
      { href: "/settings/sources", label: "Inquiry Sources", icon: faBullseye },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/events") return pathname === "/events" || /^\/events\/(?!new)/.test(pathname);
    return pathname.startsWith(href);
  }

  function NavLink({ item, nested = false }: { item: NavItem; nested?: boolean }) {
    const active = isActive(item.href);
    return (
      <Link
        href={item.href}
        className={`group flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-all ${nested ? "pl-9 pr-3" : "px-3"} ${
          active
            ? "bg-gradient-to-r from-brand to-brand-light/80 text-white shadow-lg shadow-brand/40"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
        }`}
      >
        <span
          className={`w-4 text-center text-xs ${
            active ? "text-white" : "text-zinc-400 dark:text-zinc-600 group-hover:text-brand dark:group-hover:text-brand-lighter"
          }`}
        >
          <FontAwesomeIcon icon={item.icon} fixedWidth />
        </span>
        {item.label}
      </Link>
    );
  }

  function NavGroupBlock({ group }: { group: NavGroup }) {
    const hasActiveChild = group.items.some((i) => isActive(i.href));
    const [open, setOpen] = useState(hasActiveChild);
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-all hover:bg-black/[0.05] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
        >
          <span className="w-4 text-center text-xs text-zinc-400 group-hover:text-brand dark:text-zinc-600 dark:group-hover:text-brand-lighter">
            <FontAwesomeIcon icon={group.icon} fixedWidth />
          </span>
          {group.group}
          <span className={`ml-auto text-[10px] text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </button>
        {open && (
          <div className="mt-0.5 space-y-0.5">
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} nested />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-white/[0.06] bg-white/75 dark:bg-black/40 backdrop-blur-xl">
      <div className="px-5 pt-6 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="Xpress Entertainment" className="block w-40 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Xpress Entertainment" className="hidden w-40 dark:block" />
        <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          XOS · Beta
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-600">
              {section.heading}
            </div>
            <div className="space-y-0.5">
              {section.items.map((entry) =>
                isGroup(entry) ? (
                  <NavGroupBlock key={entry.group} group={entry} />
                ) : (
                  <NavLink key={entry.href} item={entry} />
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-200 dark:border-white/[0.06] p-3">
        <ThemeToggle />
        <button
          onClick={signOut}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-500 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
        >
          <FontAwesomeIcon icon={faPowerOff} className="mr-2 text-xs" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
