import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AutoCompleteControl from "@/components/AutoCompleteControl";
import AssistantBubble from "@/components/AssistantBubble";
import { MobileNavProvider } from "@/components/MobileNav";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const [{ data: cs }, me] = await Promise.all([
    supabase
      .from("company_settings")
      .select("browser_autocomplete")
      .eq("id", true)
      .maybeSingle(),
    getMe(supabase).catch((err) => {
      console.error("getMe failed (sidebar will show all):", err);
      return null;
    }),
  ]);

  return (
    <div className="flex min-h-screen">
      <AutoCompleteControl enabled={Boolean(cs?.browser_autocomplete)} />
      <MobileNavProvider>
        <div className="print:hidden">
          <Sidebar can={me?.can} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="print:hidden">
            <TopBar />
          </div>
          <main className="min-w-0 flex-1 p-4 md:p-6 print:p-0">{children}</main>
        </div>
        {/* Assistant — Master Admin only while it's in training */}
        {me?.accountType === "staff" && me.role === "master_admin" && <AssistantBubble />}
      </MobileNavProvider>
    </div>
  );
}
