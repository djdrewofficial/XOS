"use client";

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { passkeyCeremonyMessage } from "@/lib/passkey";

export type PasskeyCall = { ok: true } | { ok: false; error: string; cancelled?: boolean };

export function passkeysLookSupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function conditionalPasskeysAvailable(): Promise<boolean> {
  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

export function cancelPasskeyCeremony() {
  WebAuthnAbortService.cancelCeremony();
}

function ceremonyFailure(error: unknown): PasskeyCall {
  const name = error instanceof Error ? error.name : undefined;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
  const message = passkeyCeremonyMessage({ name, code });
  if (!message) return { ok: false, error: "", cancelled: true };
  return { ok: false, error: message };
}

async function post(url: string, body: unknown): Promise<PasskeyCall & { options?: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; options?: unknown } | null;
  if (!data || data.ok !== true) {
    return { ok: false, error: data?.error || "That passkey didn't work. Try again." };
  }
  return { ok: true, options: data.options };
}

/** Discoverable passkey sign-in. Opens a Supabase session when the passkey checks out. */
export async function signInWithPasskey(autofill: boolean): Promise<PasskeyCall> {
  try {
    const started = await post("/api/passkey/authenticate/options", { ceremony: "login" });
    if (!started.ok || !started.options) return { ok: false, error: started.ok ? "That passkey didn't work. Try again." : started.error };
    const assertion = await startAuthentication({
      optionsJSON: started.options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      useBrowserAutofill: autofill,
    });
    return post("/api/passkey/authenticate/verify", { ceremony: "login", response: assertion });
  } catch (error) {
    return ceremonyFailure(error);
  }
}

/** Prove a passkey for the session that's already signed in. Does not open a second session. */
export async function stepUpWithPasskey(): Promise<PasskeyCall> {
  try {
    const started = await post("/api/passkey/authenticate/options", { ceremony: "stepup" });
    if (!started.ok || !started.options) return { ok: false, error: started.ok ? "That passkey didn't work. Try again." : started.error };
    const assertion = await startAuthentication({
      optionsJSON: started.options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    return post("/api/passkey/authenticate/verify", { ceremony: "stepup", response: assertion });
  } catch (error) {
    return ceremonyFailure(error);
  }
}

export async function registerPasskey(name: string): Promise<PasskeyCall> {
  try {
    const started = await post("/api/passkey/register/options", {});
    if (!started.ok || !started.options) return { ok: false, error: started.ok ? "Couldn't start adding a passkey." : started.error };
    const attestation = await startRegistration({
      optionsJSON: started.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
    return post("/api/passkey/register/verify", { response: attestation, name });
  } catch (error) {
    return ceremonyFailure(error);
  }
}
