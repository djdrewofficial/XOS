import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APP_POLICIES,
  APP_POLICY_ADDRESS,
  APP_POLICY_PATHS,
  linkPolicyText,
  policyLang,
  policyPlainText,
  type PolicyDocId,
  type PolicyLang,
} from "./appPolicies.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const DOCS: PolicyDocId[] = ["privacy", "terms", "deletion"];
const LANGS: PolicyLang[] = ["en", "es"];

describe("app policy text", () => {
  it("keeps both languages, the legal address, and both inboxes", () => {
    const address = new RegExp(APP_POLICY_ADDRESS.replace(/[.]/g, "\\."));
    for (const lang of LANGS) {
      for (const id of ["privacy", "terms"] as const) {
        assert.match(policyPlainText(id, lang), address);
      }
      for (const id of DOCS) {
        assert.match(policyPlainText(id, lang), /drew@xpressdjs\.com/);
        assert.ok(APP_POLICIES[lang][id].sections.length >= 3);
      }
      assert.match(policyPlainText("privacy", lang), /events@xpressdjs\.com/);
      assert.match(policyPlainText("terms", lang), /events@xpressdjs\.com/);
    }
    const chrome = read("src/components/AppPolicyDocument.tsx");
    assert.match(chrome, /APP_POLICY_ADDRESS/);
    assert.match(chrome, /APP_POLICY_PRIVACY_EMAIL/);
    assert.match(chrome, /APP_POLICY_SUPPORT_EMAIL/);
  });

  it("states staff AI as a plain booking notice with no opt-in or opt-out", () => {
    const en = policyPlainText("privacy", "en");
    const es = policyPlainText("privacy", "es");
    assert.match(en, /Removing client-facing song recommendations does not remove staff AI/);
    assert.match(en, /Booking with Xpress Entertainment includes notice that staff may use these AI tools/);
    assert.match(en, /There is no separate AI opt-in or opt-out in the app/);
    assert.match(en, /Marketing texts remain a separate optional choice/);
    assert.doesNotMatch(en, /unless you opt in for that event/);
    assert.doesNotMatch(en, /You can withdraw that choice/);
    assert.match(es, /Contratar con Xpress Entertainment incluye el aviso/);
    assert.match(es, /No hay una opción separada de autorización o retirada de IA/);
    assert.doesNotMatch(en, /—/);
    assert.match(en, /OpenAI/);
    assert.match(es, /no elimina la IA del personal/);
    const terms = policyPlainText("terms", "en");
    const termsEs = policyPlainText("terms", "es");
    assert.match(terms, /Booking includes that AI notice/);
    assert.match(terms, /there is no separate AI opt-in or opt-out in the app/);
    assert.match(terms, /Anyone on the event can report content or a person/);
    assert.match(terms, /Hosts can remove guest content and remove guests/);
    assert.match(terms, /Xpress can remove content that breaks these terms/);
    assert.match(termsEs, /Cualquier persona en el evento puede reportar contenido o a una persona/);
    assert.match(termsEs, /Los anfitriones pueden quitar el contenido de los invitados y quitar invitados/);
    assert.doesNotMatch(`${terms}\n${termsEs}`, /—/);
    assert.doesNotMatch(terms, /proposed separate authorization/);
    assert.doesNotMatch(en, /all AI processing has stopped/);
    assert.doesNotMatch(en, /For You has been removed from every/);
  });

  it("says deletion removes the login and leaves the booking records", () => {
    for (const lang of LANGS) {
      const privacy = policyPlainText("privacy", lang);
      const deletion = policyPlainText("deletion", lang);
      assert.doesNotMatch(`${privacy}\n${deletion}`, /—/);
      assert.doesNotMatch(deletion, /Former guest|Invitado anterior|within \d+ days|retained for \d+ years/);
    }
    const en = policyPlainText("deletion", "en");
    const es = policyPlainText("deletion", "es");
    assert.match(en, /removes your app login and access/);
    assert.match(en, /planning details, guest record, contract, and payment records stay/);
    assert.match(en, /so your DJ can perform the event and as required by law/);
    assert.match(policyPlainText("privacy", "en"), /removes your app login and access/);
    assert.match(es, /quita el acceso a la aplicación/);
    assert.match(es, /registro del invitado/);
    assert.match(es, /cuando la ley lo exige/);
  });

  it("does not print an effective date or the review banner", () => {
    for (const lang of LANGS) {
      for (const id of DOCS) {
        const text = policyPlainText(id, lang);
        assert.doesNotMatch(text, /Draft for review/);
        assert.doesNotMatch(text, /Borrador para revisión/);
        assert.doesNotMatch(text, /Last updated:/);
        assert.doesNotMatch(text, /Effective [A-Z][a-z]+ \d/);
      }
    }
  });

  it("links the other app documents and leaves the current page as text", () => {
    const parts = linkPolicyText("See the Privacy Policy and the deletion notice.", "en", "terms");
    assert.deepEqual(
      parts.map((part) => part.href ?? part.text),
      ["See the ", "/app-privacy", " and the ", "/app-data-deletion", "."],
    );
    const self = linkPolicyText("Read the Privacy Policy.", "en", "privacy");
    assert.deepEqual(self, [{ text: "Read the Privacy Policy." }]);
    const es = linkPolicyText("Vea la Política de privacidad.", "es", "terms");
    assert.equal(es[1].href, "/app-privacy?lang=es");
    assert.equal(policyLang("es"), "es");
    assert.equal(policyLang("en"), "en");
    assert.equal(policyLang(undefined), "en");
  });

  it("publishes the three app routes and leaves the booking policy in place", () => {
    const middleware = read("src/middleware.ts");
    for (const path of Object.values(APP_POLICY_PATHS)) {
      assert.match(middleware, new RegExp(path.replace("/", "\\/")));
    }
    const booking = read("src/app/privacy/page.tsx");
    assert.match(booking, /request a quote, book our/);
    assert.match(booking, /href="\/app-privacy"/);
    assert.match(booking, /href="\/app-terms"/);
    assert.match(booking, /href="\/app-data-deletion"/);
    assert.match(read("src/app/terms/page.tsx"), /href="\/app-terms"/);
    assert.match(read("src/app/terms/page.tsx"), /signed booking agreement/);
    assert.match(read("src/app/app-privacy/page.tsx"), /AppPolicyDocument/);
    assert.match(read("src/app/app-terms/page.tsx"), /id="terms"/);
    assert.match(read("src/app/app-data-deletion/page.tsx"), /id="deletion"/);
    assert.match(read("src/components/AppPolicyDocument.tsx"), /aria-current=\{lang === "en" \? "true" : undefined\}/);
    assert.match(read("src/components/AppPolicyDocument.tsx"), /<main lang=\{lang\}/);
    assert.doesNotMatch(read("src/app/app-privacy/page.tsx"), /July 15, 2026/);
  });
});
