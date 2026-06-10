"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/events/new", label: "Add Event" },
  { href: "/clients", label: "Clients" },
  { href: "/venues", label: "Venues" },
  { href: "/packages", label: "Packages" },
  { href: "/payments", label: "Payments" },
  { href: "/settings/statuses", label: "Statuses" },
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

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-zinc-950 text-zinc-300">
      <div className="px-5 py-5 text-2xl font-black tracking-tight text-white">
        X<span className="text-violet-500">OS</span>
        <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          beta 1
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href) &&
                (item.href !== "/events" || pathname === "/events" || /^\/events\/(?!new)/.test(pathname));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-600 text-white"
                  : "hover:bg-zinc-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={signOut}
        className="m-3 rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
      >
        Sign Out
      </button>
    </aside>
  );
}
