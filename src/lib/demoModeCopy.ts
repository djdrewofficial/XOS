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
    en: "This event is in demo mode. Please do not enter real information — explore with the sample data. Demo mode turns off automatically once you sign your Booking Agreement.",
    es: "Este evento está en modo demo. Por favor no ingreses información real — explora con los datos de ejemplo. El modo demo se apaga automáticamente cuando firmes tu Acuerdo de Reserva.",
  };
}

/** Default email subject / body for Send App Demo (editable via email_templates). */
export const SEND_APP_DEMO_EMAIL = {
  name: "Send App Demo",
  subject: "Try the Xpress app with your event",
  bodyHtml: `<p>Hi <first_name>,</p>
<p>We set up a quick demo of your event in the Xpress Entertainment app so you can see how planning works — timeline, songs, and more.</p>
<p><strong>This is demo mode.</strong> Feel free to tap around; you do not need to enter real details yet. Demo mode turns off automatically once you sign your Booking Agreement.</p>
<p><a href="<app_host_link>">Open your event</a></p>
<p>If you do not have the app yet, get it on the App Store:<br/><a href="<app_store_link>"><app_store_link></a></p>
<p>Talk soon,<br/>Xpress Entertainment</p>`,
};

/** Default SMS body for Send App Demo (editable via email_templates where is_sms). */
export const SEND_APP_DEMO_SMS = {
  name: "Send App Demo (SMS)",
  bodyHtml: `Hi <first_name>! Your Xpress event demo is ready (sample data only — no real info needed). Open: <app_host_link> — App Store: <app_store_link>`,
};

/** Stable template ids (seeded by migration 00240; look up by name if missing). */
export const SEND_APP_DEMO_EMAIL_TEMPLATE_ID = "d0e00001-5e1d-4a91-9e00-0000000a11e1";
export const SEND_APP_DEMO_SMS_TEMPLATE_ID = "d0e00001-5e1d-4a91-9e00-00000005e501";
