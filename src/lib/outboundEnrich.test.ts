import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { decideDelivery, enrichOutbound, type EnrichDeps } from "./outboundEnrich.ts";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function chain(single: unknown, many?: unknown) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const name of ["select", "eq", "is", "neq", "not", "order", "limit", "update", "insert"]) builder[name] = self;
  builder.maybeSingle = async () => ({ data: single ?? null, error: null });
  builder.then = (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: many ?? single ?? null, error: null });
  return builder;
}

describe("shared outbound enrichment", () => {
  it("keeps the agreement PDF and the event file on agent-rendered HTML and hands those bytes to delivery", async () => {
    const pdf = Buffer.from("%PDF-1.4 agreement");
    const photo = Buffer.from("event-file-bytes");
    const source = "<article>Booking Agreement Investment</article>";
    const writes: string[] = [];
    let generated = 0;
    let rendered = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("enrichment tried to send mail");
    };
    const supabase = {
      from(table: string) {
        if (table === "email_templates") {
          return chain({
            attach_template_id: "doc-template",
            attach_mode: "pdf",
            branded_shell: false,
            attach_file_label_ids: ["lab"],
            is_marketing: false,
          });
        }
        if (table === "events") return chain({ pay_token: "pay-token", event_type_id: null });
        if (table === "journey_settings") return chain({ proposal_flow_enabled: false, proposal_doc_template_id: null });
        if (table === "documents") return chain({ id: "doc-1", title: "Booking Agreement", signed_at: "2026-01-01", access_token: "hidden", doc_type: "contract" }, [{ id: "doc-1", title: "Booking Agreement", signed_at: "2026-01-01" }]);
        if (table === "email_log" || table === "event_files") {
          return chain(null, null);
        }
        writes.push(table);
        return chain(null, []);
      },
      storage: {
        from() {
          return {
            upload: async () => {
              writes.push("upload");
              return { error: null };
            },
          };
        },
      },
    };
    const admin = {
      from(table: string) {
        if (table === "file_label_definitions") return chain(null, [{ id: "lab", slug: "timeline", name: "Timeline", is_active: true }]);
        if (table === "event_files") {
          return chain(null, [{ name: "timeline.pdf", path: "events/timeline.pdf", content_type: "application/pdf", size_bytes: photo.length, label_id: "lab" }]);
        }
        return chain(null, []);
      },
      storage: {
        from() {
          return {
            download: async () => ({ data: { arrayBuffer: async () => Uint8Array.from(photo).buffer } }),
            createSignedUrl: async () => ({ data: null }),
          };
        },
      },
    };
    const deps: EnrichDeps = {
      fillJoinLinks: async (_event, html) => html,
      loadEventBundle: async () => null,
      quoteSummaryHtml: () => "",
      paymentPlanHtml: () => "",
      signButtonHtml: () => "<a data-sign-button>Review</a>",
      appUrl: () => "https://xos.example",
      createAdminClient: () => admin as never,
      generateDocumentRow: async () => {
        generated += 1;
        return null;
      },
      buildDocumentHtml: async () => ({ html: source, title: "Booking Agreement" }),
      htmlToPdf: async () => {
        rendered += 1;
        return pdf;
      },
    };
    try {
      const html = '<div data-xos-rendered="agent"><p>Investment</p>&lt;document_timeline&gt;</div>';
      const planned = await enrichOutbound(supabase as never, {
        id: "msg-1",
        event_id: "event-1",
        template_id: "email-1",
        body_html: html,
        attached_document_id: null,
      }, deps, { commit: true });
      assert.equal(planned.attachments.length, 2);
      assert.equal(planned.attachments[0].data.equals(photo), true);
      assert.equal(planned.attachments[1].data.equals(pdf), true);
      assert.equal(planned.attachments[0].sha256, sha(photo));
      assert.equal(planned.attachments[1].sha256, sha(pdf));
      assert.equal(planned.fileSha256[0], sha(photo));
      assert.equal(planned.documentHtmlSha256, sha(source));
      assert.match(planned.html, /data-xos-rendered="agent"/);
      assert.match(planned.html, /Investment/);
      assert.equal(planned.html.includes("document_timeline"), false);
      assert.equal(generated, 0);
      assert.equal(rendered, 1);
      const stamp = { documentHtmlSha256: planned.documentHtmlSha256, fileSha256: planned.fileSha256 };
      const sent = decideDelivery(planned, stamp);
      assert.equal(sent.deliver, true);
      assert.equal(sent.attachments[0].data.equals(photo), true);
      assert.equal(sent.attachments[1].data.equals(pdf), true);
      const refused = decideDelivery(planned, { documentHtmlSha256: sha("different agreement"), fileSha256: planned.fileSha256 });
      assert.equal(refused.deliver, false);
      assert.equal(refused.attachments.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not render or insert a missing agreement while planning, and does not add a second sign button", async () => {
    let buttons = 0;
    let rendered = 0;
    const photo = Buffer.from("floor-plan");
    const supabase = {
      from(table: string) {
        if (table === "email_templates") return chain({ attach_template_id: "doc-template", attach_mode: "esign_link", branded_shell: false, attach_file_label_ids: ["lab"], is_marketing: false });
        if (table === "events") return chain({ pay_token: "pay-token", event_type_id: null });
        if (table === "journey_settings") return chain({ proposal_flow_enabled: false, proposal_doc_template_id: null });
        if (table === "documents") return chain(null, []);
        return chain(null, []);
      },
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    };
    const admin = {
      from(table: string) {
        if (table === "file_label_definitions") return chain(null, [{ id: "lab", slug: "floor", name: "Floor", is_active: true }]);
        if (table === "event_files") return chain(null, [{ name: "floor.pdf", path: "events/floor.pdf", content_type: "application/pdf", size_bytes: photo.length }]);
        return chain(null, []);
      },
      storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => Uint8Array.from(photo).buffer } }), createSignedUrl: async () => ({ data: null }) }) },
    };
    const deps: EnrichDeps = {
      fillJoinLinks: async (_e, html) => html,
      loadEventBundle: async () => null,
      quoteSummaryHtml: () => "",
      paymentPlanHtml: () => "",
      signButtonHtml: () => {
        buttons += 1;
        return "<a data-sign-button>Review</a>";
      },
      appUrl: () => "https://xos.example",
      createAdminClient: () => admin as never,
      generateDocumentRow: async () => {
        throw new Error("planning must not create a document");
      },
      buildDocumentHtml: async () => null,
      htmlToPdf: async () => {
        rendered += 1;
        return Buffer.from("pdf");
      },
    };
    const planned = await enrichOutbound(supabase as never, {
      id: "msg-2",
      event_id: "event-1",
      template_id: "email-1",
      body_html: '<div data-xos-rendered="agent"><p>Already signed at https://xos.example/sign/placeholder</p>&lt;document_floor&gt;</div>',
      attached_document_id: null,
    }, deps, { commit: false });
    assert.equal(planned.attachments.length, 1);
    assert.equal(planned.attachments[0].data.equals(photo), true);
    assert.equal(buttons, 0);
    assert.equal(rendered, 0);
    assert.equal(planned.pdfDeferred, false);
    assert.equal(planned.html.includes("data-sign-button"), false);
  });
});
