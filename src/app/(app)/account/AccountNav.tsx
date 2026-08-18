import Link from "next/link";

/* Shared header for the My Account area: Profile + Security tabs. Security stays
   its own route (/account/security) because the middleware redirects there to
   force 2FA enrollment. */
export default function AccountNav({ active }: { active: "profile" | "security" }) {
  const tab = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 text-sm ${active === key ? "btn-primary" : "btn-ghost"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-5">
      <h1 className="page-title mb-3">My Account</h1>
      <div className="flex gap-2">
        {tab("/account", "Profile", "profile")}
        {tab("/account/security", "Security", "security")}
      </div>
    </div>
  );
}
