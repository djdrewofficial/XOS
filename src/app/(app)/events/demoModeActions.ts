"use server";

import { revalidatePath } from "next/cache";
import { requireModule, getMe } from "@/lib/auth";
import { requireOffice } from "@/lib/fieldStaff";
import {
  disableEventDemoMode,
  enableEventDemoMode,
  type DemoDisableMode,
  type DemoModeResult,
} from "@/lib/demoMode";

async function officeOnly(): Promise<void> {
  requireOffice(await getMe());
}

/** Turn Demo Mode ON. Never sends email/SMS. force=true replaces real planning data. */
export async function enableEventDemoModeAction(
  eventId: string,
  force = false,
): Promise<DemoModeResult> {
  await requireModule("events", "edit", { mode: "throw" });
  await officeOnly();
  const result = await enableEventDemoMode(eventId, { force });
  if (result.ok) {
    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/portal/plan/${eventId}`);
  }
  return result;
}

/** Turn Demo Mode OFF. clean_slate (default) or keep_client. Never sends email/SMS. */
export async function disableEventDemoModeAction(
  eventId: string,
  mode: DemoDisableMode = "clean_slate",
): Promise<DemoModeResult> {
  await requireModule("events", "edit", { mode: "throw" });
  await officeOnly();
  const result = await disableEventDemoMode(eventId, mode);
  if (result.ok) {
    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/portal/plan/${eventId}`);
  }
  return result;
}
