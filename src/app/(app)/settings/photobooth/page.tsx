import { createClient } from "@/lib/supabase/server";
import BackdropManager, { type Backdrop } from "./BackdropManager";

export const dynamic = "force-dynamic";

export default async function PhotoBoothSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("photobooth_backdrops")
    .select("id, name, category, image_url, is_active, sort_order")
    .order("sort_order");

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title mb-1">Photo Booth Backdrops</h1>
        <p className="text-sm text-zinc-500">
          Curate the backdrops couples swipe through in the planner&apos;s Photo Booth section. Designs (photo-strip
          layouts) come live from TemplatesBooth — only backdrops are managed here.
        </p>
      </div>
      <BackdropManager backdrops={(data ?? []) as Backdrop[]} />
    </div>
  );
}
