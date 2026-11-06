"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { AccessError, emailJoinCodeToHolder, removeCoupleMember, resendEventInvite, resetJoinLink, revokeEventInvite } from "@/lib/eventAccessServer";
import type { LinkRole } from "@/lib/eventAccess";

async function staffUserId(): Promise<string> {
  const supabase = await createClient();
  await requireModule("events", "edit", { mode: "throw", supabase });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  return user.id;
}

function message(err: unknown): string {
  if (err instanceof AccessError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}

export async function revokeAppInvite(eventId: string, inviteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await staffUserId();
    await revokeEventInvite({ eventId, inviteId, userId });
    revalidatePath(`/events/${eventId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function resendAppInvite(eventId: string, inviteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await staffUserId();
    await resendEventInvite({ eventId, inviteId, userId });
    revalidatePath(`/events/${eventId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function removeAppMember(eventId: string, clientId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await staffUserId();
    await removeCoupleMember({ eventId, clientId, userId });
    revalidatePath(`/events/${eventId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function resetAppJoinLink(
  eventId: string,
  role: LinkRole,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  try {
    const userId = await staffUserId();
    const link = await resetJoinLink(eventId, role, userId);
    revalidatePath(`/events/${eventId}`);
    return { ok: true, url: link.url };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function emailAppJoinCode(
  eventId: string,
  reset: boolean,
): Promise<{ ok: boolean; error?: string; emailed?: string }> {
  try {
    const userId = await staffUserId();
    const result = await emailJoinCodeToHolder({ eventId, userId, reset });
    revalidatePath(`/events/${eventId}`);
    return { ok: true, emailed: result.emailed };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
