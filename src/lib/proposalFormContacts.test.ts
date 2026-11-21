import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const formSrc = readFileSync(join(root, "src/components/ProposalForm.tsx"), "utf8");
const actionsSrc = readFileSync(join(root, "src/app/proposal/[token]/actions.ts"), "utf8");

describe("ProposalForm couple contacts (PR87 regression)", () => {
  it("always renders email/phone inputs even when blank (no OptionalInput hide)", () => {
    assert.doesNotMatch(formSrc, /function OptionalInput/);
    assert.match(formSrc, /name="a_email"/);
    assert.match(formSrc, /name="a_cell"/);
    assert.match(formSrc, /name="b_email"/);
    assert.match(formSrc, /name="b_cell"/);
    // Must not gate Partner section on non-empty values
    assert.doesNotMatch(formSrc, /props\.b\.first\.trim\(\)/);
    assert.match(formSrc, /SectionLabel>Your Partner</);
    assert.match(formSrc, /SectionLabel>Your Information</);
  });

  it("keeps Planner read-only block and still saves Partner 1 to the contract holder", () => {
    assert.match(formSrc, /SectionLabel>Planner</);
    assert.match(actionsSrc, /loadEventPartyLayout/);
    assert.match(actionsSrc, /holderId/);
    assert.match(actionsSrc, /partnerBId/);
    // Holder write always includes email + cell (empty string clears / fills), like pre-PR87
    assert.match(
      actionsSrc,
      /first_name: clean\(formData\.get\("a_first"\)\)[\s\S]*email: clean\(formData\.get\("a_email"\)\)[\s\S]*cell_phone: clean\(formData\.get\("a_cell"\)\)/,
    );
    // Partner B gate matches pre-PR87
    assert.match(actionsSrc, /formData\.has\("b_first"\) \|\| formData\.has\("b_email"\)/);
  });
});
