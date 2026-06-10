"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SECTIONS: { heading: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: "◆" },
      { href: "/events", label: "Events", icon: "▣" },
      { href: "/events/new", label: "Add Event", icon: "+" },
      { href: "/clients", label: "Clients", icon: "◉" },
    ],
  },
  {
    heading: "Directory",
    items: [
      { href: "/venues", label: "Venues", icon: "⌂" },
      { href: "/packages", label: "Packages", icon: "❖" },
      { href: "/employees", label: "Employees", icon: "✦" },
    ],
  },
  {
    heading: "Money",
    items: [{ href: "/payments", label: "Payments", icon: "$" }],
  },
  {
    heading: "Automation",
    items: [
      { href: "/settings/helpers", label: "Booking Helpers", icon: "⚡" },
      { href: "/settings/email", label: "Email", icon: "✉" },
      { href: "/settings/statuses", label: "Statuses", icon: "●" },
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

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-white/[0.06] bg-black/40 backdrop-blur-xl">
      <div className="px-5 pt-6 pb-4">
        <div className="text-[26px] font-black tracking-tight text-white">
          X
          <span className="bg-gradient-to-r from-brand-light to-brand-lighter bg-clip-text text-transparent">
            OS
          </span>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
          Xpress Entertainment
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">
              {section.heading}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      active
                        ? "bg-gradient-to-r from-brand to-brand-light/80 text-white shadow-lg shadow-brand/40"
                        : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span
                      className={`w-4 text-center text-xs ${
                        active ? "text-white" : "text-zinc-600 group-hover:text-brand-lighter"
                      }`}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <button
          onClick={signOut}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          ⏻ Sign Out
        </button>
      </div>
    </aside>
  );
}
