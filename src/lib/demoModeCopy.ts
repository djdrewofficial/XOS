/** Shared Demo Mode copy for banners and outbound “Send App Demo” messages.
    Pure strings — safe for unit tests. */

/** Official iPhone App Store listing. Never point clients at Google Play / Android. */
export const XPRESS_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/xpress-entertainment/id6788780432";

export type DemoBannerAudience = "staff" | "client";

export function demoModeBannerCopy(audience: DemoBannerAudience = "client"): {
  en: string;
  es: string;
} {
  if (audience === "staff") {
    return {
      en: "Sample planning data is loaded for this prospect. Do not treat progress, songs, or answers as real client prep. Demo Mode turns off automatically once they sign their Booking Agreement.",
      es: "Hay datos de ejemplo en el planificador de este prospecto. No trates el progreso, las canciones ni las respuestas como preparativos reales. El modo demo se apaga solo cuando firman el Acuerdo de Reserva.",
    };
  }
  return {
    en: "This event is in demo mode. Please do not enter real information. Explore with the sample data. Demo mode turns off automatically once you sign your Booking Agreement.",
    es: "Este evento está en modo demo. Por favor no ingreses información real. Explora con los datos de ejemplo. El modo demo se apaga automáticamente cuando firmes tu Acuerdo de Reserva.",
  };
}

/** Default email subject / body for Send App Demo (editable via email_templates). */
export const SEND_APP_DEMO_EMAIL = {
  name: "Send App Demo",
  subject: "Your Xpress planning app is ready",
  bodyHtml: `<p>Hi <first_name>,</p>
<p>Drew from Xpress here. Your planning app is ready to explore.</p>
<p><a href="<app_host_link>">Tap here to join your event</a></p>
<p>No app yet? Grab it here: <a href="<app_store_link>"><app_store_link></a></p>
<p>Everything inside is sample info for now, so play around and save the real details for later. Once your booking agreement is signed, it switches over to your real plan.</p>
<p>Talk soon,<br/>Drew<br/>Xpress Entertainment</p>`,
};

/** Default SMS body for Send App Demo (editable via email_templates where is_sms). */
export const SEND_APP_DEMO_SMS = {
  name: "Send App Demo (SMS)",
  bodyHtml: `Hi <first_name>! Drew from Xpress here. Your planning app is ready to explore. Tap to join your event: <app_host_link> No app yet? Grab it here: <app_store_link> Everything inside is sample info for now, so play around and save the real details for later. Once your booking agreement is signed, it switches over to your real plan.`,
};

/** Stable template ids (seeded by migration 00240; look up by name if missing). */
export const SEND_APP_DEMO_EMAIL_TEMPLATE_ID = "d0e00001-5e1d-4a91-9e00-0000000a11e1";
export const SEND_APP_DEMO_SMS_TEMPLATE_ID = "d0e00001-5e1d-4a91-9e00-00000005e501";
