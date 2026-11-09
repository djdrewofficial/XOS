import { createHash } from "node:crypto";

export type PlannedMessage = { to: string; subject: string; body: string };

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The approved send is this exact recipient list and these exact bodies. */
export function bindMessages(messages: PlannedMessage[]) {
  return messages
    .map((message) => ({ to: message.to.trim().toLowerCase(), subject: message.subject, body_sha256: sha(message.body) }))
    .sort((a, b) => a.to.localeCompare(b.to) || a.body_sha256.localeCompare(b.body_sha256));
}

export function messagesMatch(approved: { to: string; body_sha256: string }[], fresh: PlannedMessage[]): PlannedMessage[] {
  const next = bindMessages(fresh);
  const prior = [...approved].map((row) => ({ to: row.to.trim().toLowerCase(), body_sha256: row.body_sha256 })).sort((a, b) => a.to.localeCompare(b.to) || a.body_sha256.localeCompare(b.body_sha256));
  if (next.length !== prior.length || next.some((row, index) => row.to !== prior[index].to || row.body_sha256 !== prior[index].body_sha256)) {
    throw new Error("The messages changed after approval. Nothing was sent.");
  }
  return fresh;
}

export function sameIdSet(approved: string[], current: string[]): void {
  const a = [...approved].sort();
  const b = [...current].sort();
  if (a.length !== b.length || a.some((id, index) => id !== b[index])) {
    throw new Error("The pending rows changed after approval. Nothing was changed.");
  }
}
