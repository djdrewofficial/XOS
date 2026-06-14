import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AutoCompleteControl from "@/components/AutoCompleteControl";
import { MobileNavProvider } from "@/components/MobileNav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: cs } = await supabase
    .from("company_settings")
    .select("browser_autocomplete")
    .eq("id", true)
    .maybeSingle();

  return (
    <div className="flex min-h-screen">
      <AutoCompleteControl enabled={Boolean(cs?.browser_autocomplete)} />
      <MobileNavProvider>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </MobileNavProvider>
    </div>
  );
}
