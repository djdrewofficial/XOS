import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { accessAtLeast, TWO_FA_REQUIRED_ROLES } from "@/lib/permissions";
import { galleryCallbackUrl, signGalleryPass } from "@/lib/gallerySso";

/* Sign in to the photo gallery with XOS. The gallery's "Sign in with XOS" button
   sends the browser here with ?state=…; this route is login-walled (and 2FA-gated)
   by the middleware like any staff page, then returns a one-time pass to the
   gallery. Who gets in is the "Photo Gallery" row of Settings → Permissions:
   Edit = gallery admin, View = gallery editor, None = refused. */

export const dynamic = "force-dynamic";

const STATE = /^[A-Za-z0-9_-]{16,128}$/;

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const target = galleryCallbackUrl();
  const secret = process.env.GALLERY_SSO_SECRET;
  if (!target || !secret || secret.length < 32) {
    return new NextResponse("Gallery sign-in isn't set up yet (GALLERY_SSO_URL, GALLERY_SSO_SECRET).", { status: 503 });
  }
  if (!STATE.test(state)) {
    return new NextResponse("This sign-in link is incomplete. Start again from the gallery.", { status: 400 });
  }
  const here = `${url.pathname}${url.search}`;
  const back = (path: string) => noStore(NextResponse.redirect(new URL(`${path}?next=${encodeURIComponent(here)}`, url)));

  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) return back("/login");

  // The middleware already enforces 2FA, but it fails open on errors; a pass into
  // another app fails closed instead.
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || !aal) return new NextResponse("Couldn't check two-factor sign-in. Try again.", { status: 503 });
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return back("/2fa");
  if (aal.currentLevel !== "aal2" && TWO_FA_REQUIRED_ROLES.has(me.role)) {
    return noStore(NextResponse.redirect(new URL("/account/security", url)));
  }

  const access = me.accountType === "staff" ? me.can.gallery ?? "none" : "none";
  const refused = new URL(target);
  refused.searchParams.set("error", "no_access");
  if (!accessAtLeast(access, "view")) return noStore(NextResponse.redirect(refused));

  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return noStore(NextResponse.redirect(refused));
  let name = email;
  if (me.employeeId) {
    const { data: emp } = await supabase
      .from("employees")
      .select("first_name, last_name")
      .eq("id", me.employeeId)
      .maybeSingle();
    const full = [emp?.first_name, emp?.last_name].filter(Boolean).join(" ").trim();
    if (full) name = full;
  }

  const pass = signGalleryPass({ sub: me.userId, email, name, access: access === "edit" ? "edit" : "view", state }, secret);
  const done = new URL(target);
  done.searchParams.set("token", pass);
  return noStore(NextResponse.redirect(done));
}
