/* Source of truth for the e-signature consent-to-electronic-records disclosure.
   Rendered on the sign page (SignPanel) and recorded with each signed document
   (version + exact text) so we can prove which disclosure the signer agreed to.
   Bump ESIGN_CONSENT_VERSION whenever the wording below changes. */

export const ESIGN_CONSENT_VERSION = "2026-08-07";

export function esignConsentText(companyName: string): string {
  return `I agree to do business electronically with ${companyName}, and by typing my name and clicking "Sign Agreement" I am electronically signing this document and agree to be bound by its terms.`;
}
