/* Customer-facing text for the Xpress client app.
   Privacy body comes from xpress-client legalCopy.ts (14dbffe8) via appPrivacyCopy.ts.
   SMS marketing consent stays separate and optional. Review labels and App Store
   worksheet notes stay in docs/app-policies/. Privacy prints Effective date
   September 1, 2026 from that approved copy. */

import { privacyCopyEn, privacyCopyEs } from "./appPrivacyCopy";

export type PolicyLang = "en" | "es";
export type PolicyDocId = "privacy" | "terms" | "deletion";

export const APP_POLICY_ADDRESS = "11280 Pines Blvd, Pembroke Pines FL 33026";
export const APP_POLICY_ENTITY = "Xpress Entertainment Corp";
export const APP_POLICY_PRIVACY_EMAIL = "drew@xpressdjs.com";
export const APP_POLICY_SUPPORT_EMAIL = "events@xpressdjs.com";

export const APP_POLICY_PATHS: Record<PolicyDocId, string> = {
  privacy: "/app-privacy",
  terms: "/app-terms",
  deletion: "/app-data-deletion",
};

export type PolicyListItem = string | { lead: string; text: string };

export type PolicyBlock =
  | { type: "p"; text: string; lead?: string }
  | { type: "ul"; items: PolicyListItem[] }
  | { type: "table"; columns: [string, string]; rows: [string, string][] };

export type PolicySection = {
  heading: string;
  /** Simple single-paragraph sections (Terms, deletion). */
  body?: string;
  /** Structured Privacy blocks: paragraphs, lists, and tables. */
  blocks?: PolicyBlock[];
};

export type PolicyDocument = {
  id: PolicyDocId;
  title: string;
  description: string;
  navLabel: string;
  preamble?: string[];
  lead?: string;
  sections: PolicySection[];
};

const termsEn: PolicySection[] = [
  {
    heading: "1. Agreement and operator",
    body: "These Terms govern use of the Xpress client event-planning app provided by Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026. They cover app access and planning features, not a new contract for DJ or event services. Your existing booking agreement controls service pricing, payment obligations, refunds, cancellation, rescheduling and the scope of the booked services. These Terms do not replace that agreement or create new cancellation fees.",
  },
  {
    heading: "2. Eligibility and access",
    body: "The app is intended for people 18 or older who are authorized to participate in an event. Use your own account and accurate information. Keep email/password credentials secure and do not share another person's login. Email/password, Google and Apple are sign-in options. Event membership and the host's section settings determine available features. An invitation is permission to participate in the relevant event, not ownership of its records or permission to access another event. Tell events@xpressdjs.com if you believe an account or invitation is being misused.",
  },
  {
    heading: "3. Planning and booking records",
    body: "Use the app to coordinate answers, song requests, preferences, notes and supported attachments. Shared sections are visible to other authorized participants and staff. Hosts may see read-only booking and financial records when enabled; guests are not offered those host financial views. Song suggestions, notes and app displays do not by themselves change a signed booking agreement or guarantee a particular song, sequence or service. Confirm important contractual changes directly with the event team. The app does not sell an app subscription, accept card checkout or provide in-app purchases.",
  },
  {
    heading: "4. Your content and limited permission",
    body: "You keep any rights you have in the content you contribute. You give Xpress permission to store, reproduce, display and share that content only as reasonably needed to operate the planning service, collaborate with authorized participants and prepare or provide your event services, subject to the Privacy Policy and applicable permissions. This is not a general license to sell your content, use it in public advertising, or train AI beyond what the Privacy Policy describes for staff tools. Only upload materials you have the right to provide and share. Obtain appropriate permission before providing other people's information, photographs or documents.",
  },
  {
    heading: "5. Appropriate use and reports",
    body: "Do not post unlawful, threatening, harassing, hateful, exploitative, sexually abusive or infringing content; impersonate someone; spam invitations; upload malicious files; probe accounts or storage without authorization; or try to bypass event roles or security. Do not expose another person's confidential information. Send content or access concerns to events@xpressdjs.com with the event and enough detail to identify the issue, without forwarding unnecessary sensitive material. Xpress may review reports and restrict access or remove content to address misuse, safety, rights or legal requirements. You may not post anything unlawful, hateful, harassing, or spam. Anyone on the event can report content or a person. Hosts can remove guest content and remove guests. Xpress can remove content that breaks these terms.",
  },
  {
    heading: "6. Photos, documents and music",
    body: "Cover photos use public URLs and must not contain confidential material. Planner PDFs and images use separate private storage and are intended for authorized hosts and staff. Supported planner uploads are limited to 25 MB per file. Music search and public-link features rely on external catalogs and do not connect your personal music-service account. This app is for planning, not full-song streaming or transferring music ownership or performance rights. Third-party content, availability and links can change, and the providers' terms apply to their services.",
  },
  {
    heading: "7. Communications and privacy",
    body: "We use account, event and planning information as described in the Privacy Policy. Invitations and booking or account communications are distinct from optional marketing. Marketing SMS permission must be separate and optional, not a condition of using planning or accepting these Terms. Optional social handles can be skipped. Staff AI processing for booked events is described in the Privacy Policy. Booking includes that AI notice; there is no separate AI opt-in or opt-out in the app.",
  },
  {
    heading: "8. Availability and responsible reliance",
    body: "The app and external services may have interruptions, errors or changes. Keep your own copies of important documents and confirm event-critical details with our team. Nothing here promises uninterrupted availability or that every displayed record is error-free. Nothing in these Terms excludes a responsibility or consumer right that cannot lawfully be excluded.",
  },
  {
    heading: "9. Ending access and deletion",
    body: "You may stop using the app and delete your account in it. Deleting removes your app login and access. The event's planning details, guest record, contract, and payment records stay with the booking, as explained in the deletion notice. It does not cancel your event, your payment obligations, or the booking agreement.",
  },
  {
    heading: "10. Updates and contact",
    body: "Approved changes to these Terms will be identified by their effective date when published and made available in the app. Additional permissions will be requested when required; continued use is not a substitute for a required explicit consent. App and content support: events@xpressdjs.com. Privacy: drew@xpressdjs.com. Postal contact: Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026.",
  },
];

const termsEs: PolicySection[] = [
  {
    heading: "1. Acuerdo y entidad responsable",
    body: "Estas Condiciones regulan el uso de la aplicación de planificación de eventos para clientes ofrecida por Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026. Se refieren al acceso y a las funciones de planificación, no a un nuevo contrato de servicios de DJ o eventos. Su contrato de reserva existente regula precios, obligaciones de pago, reembolsos, cancelación, cambios de fecha y alcance de los servicios contratados. Estas Condiciones no lo sustituyen ni crean nuevas penalizaciones por cancelación.",
  },
  {
    heading: "2. Requisitos y acceso",
    body: "La aplicación está destinada a personas de al menos 18 años autorizadas a participar en un evento. Utilice su propia cuenta y datos correctos. Proteja sus credenciales de correo y contraseña y no comparta el acceso de otra persona. Puede iniciar sesión con correo y contraseña, Google o Apple. La pertenencia al evento y la configuración de secciones del anfitrión determinan las funciones disponibles. Una invitación permite participar en ese evento, pero no otorga propiedad sobre sus registros ni acceso a otros eventos. Avise a events@xpressdjs.com si cree que se está utilizando indebidamente una cuenta o invitación.",
  },
  {
    heading: "3. Planificación y registros de reserva",
    body: "Utilice la aplicación para coordinar respuestas, solicitudes de canciones, preferencias, notas y archivos admitidos. Las secciones compartidas son visibles para los demás participantes autorizados y el personal. Los anfitriones pueden consultar registros de reserva y financieros de solo lectura cuando estén habilitados; esas vistas financieras del anfitrión no se ofrecen a invitados. Las canciones sugeridas, notas y pantallas no modifican por sí mismas un contrato firmado ni garantizan una canción, secuencia o servicio concreto. Confirme directamente con el equipo los cambios contractuales importantes. La aplicación no vende una suscripción propia, no admite pagos con tarjeta ni ofrece compras dentro de la aplicación.",
  },
  {
    heading: "4. Su contenido y autorización limitada",
    body: "Usted conserva los derechos que tenga sobre el contenido que aporta. Autoriza a Xpress a almacenar, reproducir, mostrar y compartir ese contenido únicamente en la medida razonablemente necesaria para operar la planificación, colaborar con participantes autorizados y preparar o prestar los servicios del evento, con sujeción a la Política de privacidad y a los permisos aplicables. No es una licencia general para vender su contenido, usarlo en publicidad pública o entrenar IA más allá de lo que describe la Política de privacidad para las herramientas del personal. Suba solo materiales que tenga derecho a facilitar y compartir. Obtenga los permisos adecuados antes de aportar datos, fotos o documentos de otras personas.",
  },
  {
    heading: "5. Uso adecuado y avisos",
    body: "No publique contenido ilícito, amenazante, de acoso, de odio, de explotación, de abuso sexual o que infrinja derechos; no suplante identidades; no envíe invitaciones masivas no deseadas; no suba archivos maliciosos; no explore cuentas o almacenamiento sin autorización; ni intente eludir roles o seguridad. No exponga información confidencial ajena. Informe de problemas de contenido o acceso a events@xpressdjs.com, indicando el evento y detalles suficientes para identificar el problema, sin reenviar material sensible innecesario. Xpress podrá revisar avisos y restringir accesos o retirar contenido para abordar usos indebidos, seguridad, derechos u obligaciones legales. No publiques nada ilegal, de odio, acosador o spam. Cualquier persona en el evento puede reportar contenido o a una persona. Los anfitriones pueden quitar el contenido de los invitados y quitar invitados. Xpress puede quitar el contenido que incumpla estos términos.",
  },
  {
    heading: "6. Fotos, documentos y música",
    body: "Las portadas utilizan URL públicas y no deben contener material confidencial. Los PDF y las imágenes del planificador usan almacenamiento privado separado y están destinados a anfitriones autorizados y personal. Los archivos del planificador admitidos tienen un máximo de 25 MB cada uno. Las búsquedas de música y los enlaces públicos dependen de catálogos externos y no conectan su cuenta personal de música. La aplicación sirve para planificar, no para reproducir canciones completas ni transferir derechos de propiedad o ejecución musical. El contenido, la disponibilidad y los enlaces de terceros pueden cambiar, y a sus servicios se aplican sus propias condiciones.",
  },
  {
    heading: "7. Comunicaciones y privacidad",
    body: "Utilizamos los datos de cuenta, evento y planificación según la Política de privacidad. Las invitaciones y comunicaciones de reserva o cuenta son distintas del marketing opcional. La autorización de SMS de marketing debe ser separada y opcional, no una condición para planificar o aceptar estas Condiciones. Puede omitir las redes sociales opcionales. El tratamiento mediante IA del personal para eventos reservados se describe en la Política de privacidad. La reserva incluye ese aviso de IA; no hay una opción separada de autorización o retirada de IA en la aplicación.",
  },
  {
    heading: "8. Disponibilidad y uso responsable",
    body: "La aplicación y los servicios externos pueden sufrir interrupciones, errores o cambios. Conserve sus propias copias de documentos importantes y confirme con nuestro equipo los detalles esenciales del evento. Estas Condiciones no prometen disponibilidad ininterrumpida ni ausencia de errores en todos los registros mostrados. No excluyen ninguna responsabilidad ni derecho del consumidor que no pueda excluirse legalmente.",
  },
  {
    heading: "9. Fin del acceso y eliminación",
    body: "Puede dejar de usar la aplicación y eliminar su cuenta dentro de ella. Eliminar quita el acceso a la aplicación. Los detalles de planificación del evento, el registro del invitado, el contrato y los registros de pago permanecen con la reserva, según el aviso de eliminación. No cancela su evento, sus obligaciones de pago ni el contrato de reserva.",
  },
  {
    heading: "10. Cambios y contacto",
    body: "Los cambios aprobados se identificarán mediante su fecha de entrada en vigor al publicarse y ponerse a disposición en la aplicación. Se solicitarán permisos adicionales cuando proceda; seguir usando la aplicación no sustituye un consentimiento expreso exigible. Soporte y avisos de contenido: events@xpressdjs.com. Privacidad: drew@xpressdjs.com. Dirección postal: Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026.",
  },
];

const deletionEn: PolicySection[] = [
  {
    heading: "What deletion removes",
    body: "Deleting your account removes your app login and access. You cannot sign back in with that login. We remove the app account record, event app memberships, and device tokens for that login. You can start this from the account deletion option in the app. If you cannot open the app, contact drew@xpressdjs.com. Staff accounts use a separate process. This client route refuses staff accounts.",
  },
  {
    heading: "What stays with the booking",
    body: "The event's planning details, guest record, contract, and payment records stay with the booking so your DJ can perform the event and as required by law. Songs, answers, notes, and the names on the guest and booking records are not removed by this deletion. It does not cancel the event or change payment obligations.",
  },
  {
    heading: "Sign in with Apple",
    body: "If you signed in with Apple, we try to revoke that sign-in. The login is still removed if that request fails. App support is events@xpressdjs.com.",
  },
];

const deletionEs: PolicySection[] = [
  {
    heading: "Qué quita la eliminación",
    body: "Eliminar su cuenta quita el acceso a la aplicación. No podrá volver a entrar con ese acceso. Quitamos el registro de la cuenta de la aplicación, las pertenencias al evento en la aplicación y los tokens de dispositivo de ese acceso. Puede iniciarlo desde la opción de eliminación de cuenta en la aplicación. Si no puede abrir la aplicación, escriba a drew@xpressdjs.com. Las cuentas del personal usan otro proceso. Esta vía del cliente rechaza las cuentas del personal.",
  },
  {
    heading: "Qué permanece con la reserva",
    body: "Los detalles de planificación del evento, el registro del invitado, el contrato y los registros de pago permanecen con la reserva para que su DJ pueda realizar el evento y cuando la ley lo exige. Las canciones, respuestas, notas y los nombres de los registros de invitado y de reserva no se quitan con esta eliminación. No cancela el evento ni cambia las obligaciones de pago.",
  },
  {
    heading: "Iniciar sesión con Apple",
    body: "Si inició sesión con Apple, intentamos revocar ese acceso. El acceso se elimina aunque esa solicitud falle. El soporte de la aplicación es events@xpressdjs.com.",
  },
];

export const APP_POLICIES: Record<PolicyLang, Record<PolicyDocId, PolicyDocument>> = {
  en: {
    privacy: {
      id: "privacy",
      title: privacyCopyEn.title,
      description: "Privacy policy for the Xpress DJs event-planning app.",
      navLabel: "Privacy Policy",
      preamble: [...privacyCopyEn.preamble],
      sections: privacyCopyEn.sections as unknown as PolicySection[],
    },
    terms: {
      id: "terms",
      title: "Terms of Use",
      description: "Terms of use for the Xpress Entertainment client event-planning app.",
      navLabel: "Terms of Use",
      sections: termsEn,
    },
    deletion: {
      id: "deletion",
      title: "Account deletion",
      description: "Deleting an Xpress app login removes access. The booking and its planning details stay.",
      navLabel: "Account deletion",
      lead: "Deleting your account removes your app login and access. The event's planning details, guest record, contract, and payment records stay with the booking so your DJ can perform the event and as required by law.",
      sections: deletionEn,
    },
  },
  es: {
    privacy: {
      id: "privacy",
      title: privacyCopyEs.title,
      description: "Política de privacidad de la aplicación Xpress DJs.",
      navLabel: "Política de privacidad",
      preamble: [...privacyCopyEs.preamble],
      sections: privacyCopyEs.sections as unknown as PolicySection[],
    },
    terms: {
      id: "terms",
      title: "Condiciones de uso",
      description: "Condiciones de uso de la aplicación de planificación de eventos de Xpress Entertainment.",
      navLabel: "Condiciones de uso",
      sections: termsEs,
    },
    deletion: {
      id: "deletion",
      title: "Eliminación de cuenta",
      description: "Eliminar el acceso a la aplicación de Xpress quita la entrada. La reserva y sus detalles de planificación permanecen.",
      navLabel: "Eliminación de cuenta",
      lead: "Eliminar su cuenta quita el acceso a la aplicación. Los detalles de planificación del evento, el registro del invitado, el contrato y los registros de pago permanecen con la reserva para que su DJ pueda realizar el evento y cuando la ley lo exige.",
      sections: deletionEs,
    },
  },
};

export function policyLang(value: string | undefined): PolicyLang {
  return value === "es" ? "es" : "en";
}

export function policyHref(id: PolicyDocId, lang: PolicyLang): string {
  const path = APP_POLICY_PATHS[id];
  return lang === "es" ? `${path}?lang=es` : path;
}

export type PolicyTextPart = { text: string; href?: string };

const LINK_PHRASES: Record<PolicyLang, Array<{ phrase: string; id: PolicyDocId }>> = {
  en: [
    { phrase: "Privacy Policy", id: "privacy" },
    { phrase: "deletion notice", id: "deletion" },
    { phrase: "Terms of Use", id: "terms" },
    { phrase: "these Terms", id: "terms" },
  ],
  es: [
    { phrase: "Política de privacidad", id: "privacy" },
    { phrase: "aviso de eliminación", id: "deletion" },
    { phrase: "Condiciones de uso", id: "terms" },
    { phrase: "estas Condiciones", id: "terms" },
  ],
};

/** Link cross-references to the other app policy pages. The current page is left as text. */
export function linkPolicyText(text: string, lang: PolicyLang, here: PolicyDocId): PolicyTextPart[] {
  const phrases = LINK_PHRASES[lang].filter((item) => item.id !== here);
  const parts: PolicyTextPart[] = [{ text }];
  for (const item of phrases) {
    const next: PolicyTextPart[] = [];
    for (const part of parts) {
      if (part.href) {
        next.push(part);
        continue;
      }
      const chunks = part.text.split(item.phrase);
      chunks.forEach((chunk, index) => {
        if (chunk) next.push({ text: chunk });
        if (index < chunks.length - 1) next.push({ text: item.phrase, href: policyHref(item.id, lang) });
      });
    }
    parts.splice(0, parts.length, ...next);
  }
  return parts.filter((part) => part.text.length > 0);
}

function listItemText(item: PolicyListItem): string {
  return typeof item === "string" ? item : `${item.lead} ${item.text}`.replace(/\s+/g, " ").trim();
}

function sectionPlainText(section: PolicySection): string[] {
  const parts: string[] = [section.heading];
  if (section.body) parts.push(section.body);
  for (const block of section.blocks ?? []) {
    if (block.type === "p") {
      parts.push(block.lead ? `${block.lead} ${block.text}` : block.text);
    } else if (block.type === "ul") {
      for (const item of block.items) parts.push(listItemText(item));
    } else {
      parts.push(block.columns.join(" | "));
      for (const row of block.rows) parts.push(row.join(" | "));
    }
  }
  return parts;
}

export function policyPlainText(id: PolicyDocId, lang: PolicyLang): string {
  const doc = APP_POLICIES[lang][id];
  return [doc.title, ...(doc.preamble ?? []), doc.lead ?? "", ...doc.sections.flatMap(sectionPlainText)]
    .filter(Boolean)
    .join("\n");
}
