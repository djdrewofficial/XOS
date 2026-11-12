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
import { privacyCopyEn, privacyCopyEs } from "./appPrivacyCopy.ts";
import { APP_SUPPORT_PATH, supportPlainText } from "./appSupport.ts";

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
        assert.ok(APP_POLICIES[lang][id].sections.length >= 1);
      }
      assert.match(policyPlainText("privacy", lang), /events@xpressdjs\.com/);
      assert.match(policyPlainText("terms", lang), /events@xpressdjs\.com/);
    }
    const chrome = read("src/components/AppPolicyDocument.tsx");
    assert.match(chrome, /APP_POLICY_ADDRESS/);
    assert.match(chrome, /APP_POLICY_PRIVACY_EMAIL/);
    assert.match(chrome, /APP_POLICY_SUPPORT_EMAIL/);
    assert.doesNotMatch(chrome, /sr-only/);
  });

  it("publishes the approved privacy copy with the September 1, 2026 effective date", () => {
    const en = policyPlainText("privacy", "en");
    const es = policyPlainText("privacy", "es");
    assert.match(en, /Effective date: September 1, 2026/);
    assert.match(es, /Fecha de entrada en vigor: 1 de septiembre de 2026/);
    assert.match(en, /Xpress Entertainment Corp \("Xpress", "we", "us"\) makes the Xpress DJs app/);
    assert.match(en, /Every provider that receives personal information from us is bound/);
    assert.match(en, /Fireflies/);
    assert.match(en, /open the My Event tab and tap Delete account/);
    assert.match(es, /abra la pestaña Mi evento y toque Eliminar cuenta/);
    assert.equal(APP_POLICIES.en.privacy.preamble?.[1], privacyCopyEn.preamble[1]);
    assert.equal(APP_POLICIES.es.privacy.preamble?.[1], privacyCopyEs.preamble[1]);
    assert.equal(APP_POLICIES.en.privacy.sections.length, privacyCopyEn.sections.length);
    assert.doesNotMatch(en, /—/);
    assert.doesNotMatch(es, /—/);
  });

  it("keeps terms and deletion login-removal language", () => {
    for (const lang of LANGS) {
      const deletion = policyPlainText("deletion", lang);
      assert.doesNotMatch(deletion, /—/);
      assert.doesNotMatch(deletion, /Former guest|Invitado anterior|within \d+ days|retained for \d+ years/);
    }
    const en = policyPlainText("deletion", "en");
    const es = policyPlainText("deletion", "es");
    assert.match(en, /removes your app login and access/);
    assert.match(en, /planning details, guest record, contract, and payment records stay/);
    assert.match(en, /so your DJ can perform the event and as required by law/);
    assert.match(es, /quita el acceso a la aplicación/);
    assert.match(es, /registro del invitado/);
    assert.match(es, /cuando la ley lo exige/);
    const terms = policyPlainText("terms", "en");
    const termsEs = policyPlainText("terms", "es");
    assert.match(terms, /Anyone on the event can report content or a person/);
    assert.match(termsEs, /Cualquier persona en el evento puede reportar contenido o a una persona/);
    assert.doesNotMatch(`${terms}\n${termsEs}`, /—/);
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

  it("publishes the app policy routes and leaves the booking policy in place", () => {
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

describe("public app store support and privacy routes", () => {
  it("keeps /app-privacy and /support public so they render logged out", () => {
    const middleware = read("src/middleware.ts");
    const publicBlock = middleware.slice(middleware.indexOf("const isPublic"), middleware.indexOf("if (isPublic)"));
    assert.match(publicBlock, /pathname\.startsWith\("\/app-privacy"\)/);
    assert.match(publicBlock, /pathname\.startsWith\("\/support"\)/);
    assert.equal(APP_SUPPORT_PATH, "/support");
    assert.match(read("src/app/support/page.tsx"), /APP_SUPPORT/);
    assert.match(read("src/app/support/page.tsx"), /APP_POLICY_SUPPORT_EMAIL/);
    assert.doesNotMatch(read("src/app/support/page.tsx"), /createClient|getUser|supabase\.auth/);
    assert.doesNotMatch(read("src/app/app-privacy/page.tsx"), /createClient|getUser|supabase\.auth/);
    assert.match(supportPlainText("en"), /Xpress DJs app support/);
    assert.match(supportPlainText("en"), /events@xpressdjs\.com/);
    assert.match(supportPlainText("en"), /Forgot password/);
    assert.match(supportPlainText("en"), /My Event tab/);
    assert.match(supportPlainText("en"), /Delete account/);
    assert.match(supportPlainText("es"), /Si necesita ayuda/);
    assert.match(supportPlainText("es"), /Incluya su nombre/);
    assert.match(supportPlainText("es"), /Mi evento/);
    assert.match(supportPlainText("es"), /Eliminar cuenta/);
    assert.doesNotMatch(supportPlainText("en"), /—/);
    assert.doesNotMatch(supportPlainText("es"), /—/);
    assert.doesNotMatch(read("src/app/support/page.tsx"), /—/);
    assert.doesNotMatch(`${supportPlainText("en")}\n${supportPlainText("es")}`, /\d{3}[-.)]\d{3}/);
  });
});
