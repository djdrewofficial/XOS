import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { finalizeOutbound } from "./outboundPlan.ts";

describe("outbound attachments", () => {
  it("keeps a PDF and an event file on agent-rendered HTML", () => {
    const pdf = Buffer.from("%PDF-1.4 agreement");
    const photo = Buffer.from("event-file-bytes");
    const html = '<div data-xos-rendered="agent"><p>Your Booking Agreement</p><p>Investment</p></div>';
    const planned = finalizeOutbound(html, [
      { filename: "Booking Agreement.pdf", contentType: "application/pdf", data: pdf },
      { filename: "timeline.pdf", contentType: "application/pdf", data: photo },
    ]);
    assert.equal(planned.html, html);
    assert.equal(planned.attachments.length, 2);
    assert.equal(planned.attachments[0].sha256, createHash("sha256").update(pdf).digest("hex"));
    assert.equal(planned.attachments[1].bytes, photo.length);
    assert.equal(planned.attachments[0].data.equals(pdf), true);
    assert.match(planned.attachments[0].filename, /Booking Agreement/);
  });
});
