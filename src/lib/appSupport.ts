/* Public support copy for the Xpress DJs iOS app (App Store support URL).
   Spanish uses usted. No phone number: none is published in public config. */

import { APP_POLICY_PATHS, APP_POLICY_SUPPORT_EMAIL, policyLang, type PolicyLang } from "./appPolicies";

export const APP_SUPPORT_PATH = "/support";

export type SupportSection = { heading: string; body: string };

export type SupportDocument = {
  title: string;
  description: string;
  intro: string;
  sections: SupportSection[];
  privacyLabel: string;
  privacyHref: string;
};

const supportEn: SupportDocument = {
  title: "Xpress DJs app support",
  description: "Help for the Xpress DJs event-planning app.",
  intro:
    "This page is for people using the Xpress DJs mobile app. For help with your event or your app account, email us. We answer in English or Spanish.",
  sections: [
    {
      heading: "Contact",
      body: `Email ${APP_POLICY_SUPPORT_EMAIL}. Include your name, the email on your app account, and a short description of the problem.`,
    },
    {
      heading: "Sign in",
      body: "Open the Xpress DJs app and sign in with the email and password you used to create your account, or with Google or Apple if that is how you signed up.",
    },
    {
      heading: "Reset password",
      body: "On the sign-in screen, tap Forgot password, enter the email for your account, and follow the reset steps in the app.",
    },
    {
      heading: "Delete account",
      body: "In the app, open the My Event tab, then tap Delete account. That removes your app login. Your event booking records stay with your booking. You can also email us if you cannot open the app.",
    },
  ],
  privacyLabel: "Privacy Policy",
  privacyHref: APP_POLICY_PATHS.privacy,
};

const supportEs: SupportDocument = {
  title: "Soporte de la aplicación Xpress DJs",
  description: "Ayuda para la aplicación de planificación de eventos Xpress DJs.",
  intro:
    "Esta página es para quienes usan la aplicación móvil Xpress DJs. Si necesita ayuda con su evento o con su cuenta de la aplicación, escríbanos. Respondemos en inglés o en español.",
  sections: [
    {
      heading: "Contacto",
      body: `Correo: ${APP_POLICY_SUPPORT_EMAIL}. Incluya su nombre, el correo de su cuenta en la aplicación y una breve descripción del problema.`,
    },
    {
      heading: "Iniciar sesión",
      body: "Abra la aplicación Xpress DJs e inicie sesión con el correo y la contraseña que usó para crear su cuenta, o con Google o Apple si así se registró.",
    },
    {
      heading: "Restablecer la contraseña",
      body: "En la pantalla de inicio de sesión, toque Olvidé mi contraseña, escriba el correo de su cuenta y siga los pasos de restablecimiento en la aplicación.",
    },
    {
      heading: "Eliminar la cuenta",
      body: "En la aplicación, abra la pestaña Mi evento y toque Eliminar cuenta. Eso quita su acceso a la aplicación. Los registros de su reserva permanecen con la reserva. También puede escribirnos si no puede abrir la aplicación.",
    },
  ],
  privacyLabel: "Política de privacidad",
  privacyHref: `${APP_POLICY_PATHS.privacy}?lang=es`,
};

export const APP_SUPPORT: Record<PolicyLang, SupportDocument> = {
  en: supportEn,
  es: supportEs,
};

export function supportHref(lang: PolicyLang): string {
  return lang === "es" ? `${APP_SUPPORT_PATH}?lang=es` : APP_SUPPORT_PATH;
}

export function supportLang(value: string | undefined): PolicyLang {
  return policyLang(value);
}

export function supportPlainText(lang: PolicyLang): string {
  const doc = APP_SUPPORT[lang];
  return [doc.title, doc.intro, ...doc.sections.flatMap((s) => [s.heading, s.body]), doc.privacyLabel]
    .filter(Boolean)
    .join("\n");
}
