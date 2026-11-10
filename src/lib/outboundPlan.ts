import { createHash } from "node:crypto";

export type OutboundFile = { filename: string; contentType: string; data: Buffer };

export type PlannedAttachment = OutboundFile & { sha256: string; bytes: number };

/** The bytes that will be delivered. Agent-rendered HTML does not drop files. */
export function finalizeOutbound(html: string, files: OutboundFile[]): { html: string; attachments: PlannedAttachment[] } {
  const attachments = files.map((file) => {
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    return { filename: file.filename, contentType: file.contentType, data: file.data, sha256, bytes: file.data.length };
  });
  return { html, attachments };
}
