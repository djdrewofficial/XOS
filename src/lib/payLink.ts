import { appUrl } from "@/lib/signing";

/** Full client pay URL for an event pay_token, using the same base as other client links. */
export function buildPayUrl(payToken: string | null | undefined): string | null {
  const token = typeof payToken === "string" ? payToken.trim() : "";
  if (!token) return null;
  return `${appUrl().replace(/\/$/, "")}/pay/${token}`;
}

/** Copy text with clipboard API, falling back to a temporary textarea + execCommand. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to legacy path */
    }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/** Short display form of a pay URL for the event page (keeps host + /pay/ prefix). */
export function truncatePayUrl(url: string, keepEnd = 8): string {
  try {
    const u = new URL(url);
    const token = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (token.length <= keepEnd + 4) return url;
    return `${u.origin}/pay/${token.slice(0, 4)}…${token.slice(-keepEnd)}`;
  } catch {
    if (url.length <= 48) return url;
    return `${url.slice(0, 36)}…${url.slice(-8)}`;
  }
}
