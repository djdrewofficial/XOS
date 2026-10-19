/* Single sign-on into the photo gallery (photobooth.xpressdjs.com, the separate
   "xpress-gallery" app). XOS is the identity provider: /sso/gallery hands a signed-in
   staff member a one-time pass and sends them back to the gallery, which checks it.

   The pass is `<payload>.<signature>`, both base64url: the payload is JSON, the
   signature is HMAC-SHA256 of the payload text with GALLERY_SSO_SECRET (the same
   value is set on the gallery as XOS_SSO_SECRET). It lives 60 seconds and carries the
   gallery's `state`, so it only works in the browser that started the sign-in; the
   gallery also refuses a pass it has already seen. Server-only (node:crypto). */

import crypto from "node:crypto";
import type { Access } from "@/lib/permissions";

export type GalleryPass = {
  iss: "xos";
  aud: "xpress-gallery";
  /** XOS auth user id. */
  sub: string;
  email: string;
  name: string;
  /** Effective "Photo Gallery" access: edit = gallery admin, view = gallery editor. */
  access: Exclude<Access, "none">;
  /** The gallery's sign-in attempt, echoed back. */
  state: string;
  iat: number;
  exp: number;
  /** Unique per pass, so the gallery can refuse a replay. */
  jti: string;
};

export const GALLERY_PASS_SECONDS = 60;

/** Where passes are delivered, e.g. https://photobooth.xpressdjs.com/api/auth/xos/callback.
    Fixed by configuration (never taken from the request), so /sso/gallery can't be used
    to send a pass anywhere else. */
export function galleryCallbackUrl(): string | null {
  const raw = process.env.GALLERY_SSO_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.hostname === "localhost" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function signGalleryPass(
  fields: Pick<GalleryPass, "sub" | "email" | "name" | "access" | "state">,
  secret: string,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const pass: GalleryPass = {
    iss: "xos",
    aud: "xpress-gallery",
    ...fields,
    iat,
    exp: iat + GALLERY_PASS_SECONDS,
    jti: crypto.randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(pass)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
