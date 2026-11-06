"use server";

import { revalidatePath } from "next/cache";
import { removePasskeyForSession, renamePasskeyForSession, type PasskeyResult } from "@/lib/passkeyServer";

export async function renamePasskey(id: string, name: string): Promise<PasskeyResult> {
  const result = await renamePasskeyForSession(id, name);
  if (result.ok) revalidatePath("/account/security");
  return result;
}

export async function removePasskey(id: string): Promise<PasskeyResult> {
  const result = await removePasskeyForSession(id);
  if (result.ok) revalidatePath("/account/security");
  return result;
}
