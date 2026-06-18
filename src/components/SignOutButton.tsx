"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPowerOff } from "@fortawesome/free-solid-svg-icons";

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className={className ?? "btn-ghost px-4 py-2 text-sm"}
    >
      <FontAwesomeIcon icon={faPowerOff} className="mr-2 text-xs" />
      Sign Out
    </button>
  );
}
