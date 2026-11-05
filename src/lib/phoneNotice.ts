import { cookies } from "next/headers";

const COOKIE = "xos_phone_notice";

/** Non-blocking note after a phone save whose sign-in number could not be updated. */
export async function flashPhoneNotice(notice: string | null | undefined): Promise<void> {
  if (!notice) return;
  try {
    const jar = await cookies();
    jar.set(COOKIE, notice, { path: "/", maxAge: 60, sameSite: "lax", httpOnly: true });
  } catch {
    /* the warning is already logged */
  }
}

export async function readPhoneNotice(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
