/* Customer-facing text for the Xpress client app.
   The wording is the approved November 6, 2026 pack. Review labels, the App Store
   worksheet, the unimplemented AI opt-in, and in-app button specs stay in
   docs/app-policies/. These pages do not set an effective date. */

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

export type PolicySection = { heading: string; body: string };

export type PolicyDocument = {
  id: PolicyDocId;
  title: string;
  description: string;
  navLabel: string;
  lead?: string;
  sections: PolicySection[];
};

const privacyEn: PolicySection[] = [
  {
    heading: "1. Who we are and what this policy covers",
    body: "Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026, provides this event-planning app. This policy explains information handled through the app and related XOS staff workflows. It distinguishes information you enter in the app from booking and customer records we already hold and display or use for your event. Our separate websites, booking agreements and external payment services may involve additional information and notices.",
  },
  {
    heading: "2. Accounts and sign-in",
    body: "We use Supabase for account authentication, database services and storage. You may sign in with email and password, Google, or Apple. We handle your account email, account and authentication identifiers, event membership and role, and identity information returned by your chosen provider, which may include your name. Apple may provide a private relay email instead of your personal email. Email confirmation and password-reset messages support account access. The app is not intended to collect your Apple or Google password. The provider's own terms and privacy notice apply to its sign-in service.",
  },
  {
    heading: "3. Booking information and event records",
    body: "Our booking and customer-management records may include names, organization, phone number, email, mailing address, anniversary, notes, SMS opt-in status and timestamp, and optional Instagram or TikTok handles. These records can exist independently of an app account. An event host's app can show existing event and booking details and, when enabled, read-only financial information such as the package, add-ons, travel, overtime, discounts, payment records and payment schedules. Showing these records does not mean the app collected them originally. The app does not provide card checkout, in-app purchases or an app subscription.",
  },
  {
    heading: "4. Planning content you provide",
    body: "We store answers to planning questions, song selections and suggestions, song titles and other provider metadata, provider names and public music or playlist links, request attribution, likes, must-play and do-not-play preferences, notes and avoid-list content. Section notes can contain up to 4,000 characters. Answers and other contributions can be associated with an author or account identifier. Please include only information needed to plan the event. Do not put passwords, card numbers, government identification, or unnecessary sensitive information about yourself or others in planning fields or attachments.",
  },
  {
    heading: "5. Shared event access",
    body: "Event planning is collaborative. Hosts and staff can access event planning content for their roles. Guests can contribute to sections the host has opened to guests. Host-only financial information, host-only avoid-list content and planner files are intended to be restricted by role. Information you contribute to a shared section is not a private message to staff. Avoid putting confidential material into shared sections, and contact support if access appears wrong. Event access controls do not make a publicly hosted cover-photo URL private.",
  },
  {
    heading: "6. Photos, files and invitations",
    body: "A host or staff member can upload an event cover photo. Cover photos are stored in the public event-photos bucket and anyone with the photo URL may access them, even when app editing is restricted. Planner PDFs and images are stored separately in the private event-files bucket, with a maximum file size of 25 MB, for staff and authorized event hosts. When a host invites someone, we handle the person's name, email and relationship to the event to create and send the invitation. Mailgun processes invitation emails, and guest and email-log records are retained separately from login accounts. Provide another person's details only when you have a proper basis to invite them, and let them know the invitation concerns shared event planning.",
  },
  {
    heading: "7. Clipboard and technical information",
    body: "The app makes a one-time clipboard check to offer an event join link; joining through that offer requires a tap. A clipboard check is not a request for your address book. Failed join attempts are logged with IP address, user identifier and a hash of the join code for access and abuse handling. Service providers and servers may also handle technical request and service logs. This policy does not promise an absence of all logging. A web contract signature workflow can record IP address and user agent; that is a separate web workflow, not direct collection by the iOS contract-signature feature.",
  },
  {
    heading: "8. Why we use information",
    body: "We use account and event information to authenticate you, associate you with the correct event, save and share planning contributions, prepare and deliver booked services, show relevant booking records, send invitations and operational messages, respond to support, and investigate security or access problems. Optional social handles are not required for core planning. Marketing texts require a separate optional permission and must not be bundled into acceptance of these policies or access to planning. Operational messages about your account, invitations or booking are distinct from marketing. Marketing texts are a separate choice, off until you turn them on, and they are stored only for the mobile number already on your booking record. That choice records the time, the disclosure version, and whether it came from the app or the web. It is not permission for email, and it is not permission for booking or account texts. You can withdraw it later in the app. Replying STOP still stops texts to that number. If no mobile number is on file, we do not store a marketing text choice.",
  },
  {
    heading: "9. Providers and external content",
    body: "In addition to Supabase, Apple and Google sign-in and Mailgun invitations, music tools use Spotify, Apple Music, iTunes Search and YouTube for catalog searches or public-link lookups. The relevant query text or public playlist or video link can be sent to the provider. These tools do not link your personal music-service account, and the app is not a full-song streaming service. TemplatesBooth receives photo-booth catalog filters, not the event's identity in the reviewed lookup. Expo supplies app updates. Staff communication workflows can use HighLevel and may create or update a contact's name, email and phone number; that is not a direct client-app integration. PayPal is associated with the website, not an iOS checkout. The sender configured for Supabase authentication emails has not been established as Mailgun.",
  },
  {
    heading: "10. Staff AI processing",
    body: "Removing client-facing song recommendations does not remove staff AI. Staff XOS tools can send OpenAI event and planning information for summaries, event questions and run-of-show drafts. Depending on the tool, inputs include client names, email, phone, venue and address, planning answers, songs, notes, must-play and do-not-play details, internal notes and Fireflies meeting transcripts. A morning briefing can include event or couple names, venues, payment amounts and unsigned-contract dates. A staff assistant can also receive content staff paste into it. These are separate staff workflows, not music-account linking. This disclosure is not itself permission to send personal data to third-party AI. Where explicit permission is required, it must be obtained before the sharing. Do not treat general policy acceptance or a host's invitation as another person's AI permission. Staff AI tools do not send your personal data to OpenAI unless you opt in for that event in the app. You can withdraw that choice later in the app. Opting in can include your name, email, phone, venue and address, planning answers, song choices, notes, must-play and do-not-play details, internal event notes, and meeting transcripts. A morning briefing can include the event name, venue, payment amounts, and unsigned contract dates only after that opt-in. Withdrawal stops later staff AI use of your personal data for that event. It does not undo a transfer that already happened. Your opt-in covers only you and that event. It does not cover a guest or co-host. Their contact details and free-text answers are left out unless that person has their own opt-in. Call transcripts and internal notes are not sent to OpenAI. The staff assistant can still receive words a staff member types. Email addresses and phone numbers in that chat are refused. A name typed in a sentence is not fully blocked there.",
  },
  {
    heading: "11. Other disclosures and advertising",
    body: "We disclose information to the people involved in your event and to providers as described above. We may also disclose information where required by applicable law, to respond to lawful requests, or as necessary to address fraud, abuse or legal claims, subject to applicable protections. No advertising or cross-app tracking SDK was identified in the reviewed client code. That finding is not a guarantee about every server log or every provider's independent practices, and it does not establish unverified vendor contractual terms. Any materially different collection or use needs appropriate notice and any required permission.",
  },
  {
    heading: "12. Deletion",
    body: "Deleting your account removes your app login and access. You cannot sign back in with that login. We remove the app account record, event app memberships, and device tokens for that login. The event's planning details, guest record, contract, and payment records stay with the booking so your DJ can perform the event and as required by law. If you signed in with Apple, we try to revoke that sign-in. The login is still removed if that request fails.",
  },
  {
    heading: "13. Choices, rights and security",
    body: "You can omit optional social information, choose what appropriate planning content and files to submit, and initiate login deletion in the app. You may contact drew@xpressdjs.com to request access, correction, a copy, deletion of retained information, or withdrawal of an optional consent. Rights and exceptions depend on applicable law. We may need to verify your identity and your connection to the event without asking for unnecessary information. Information about other people may need separate handling. A withdrawal does not undo processing already completed or remove records that must lawfully be retained. No security method is a guarantee against unauthorized access; do not treat public cover photos as secure storage.",
  },
  {
    heading: "14. Eligibility and changes",
    body: "The app's selected eligibility rule is 18 or older; this is not a statement of Apple's age rating and does not imply age verification. Do not submit unnecessary information about children. If you believe a child has provided personal information through the app, contact us. Changes to this policy will be identified with a revision or effective date when approved and published. A notice alone does not replace any permission required for a new use.",
  },
  {
    heading: "15. Contact",
    body: "For privacy questions and data requests: drew@xpressdjs.com. For app help, event access and content reports: events@xpressdjs.com. Postal contact: Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026.",
  },
];

const privacyEs: PolicySection[] = [
  {
    heading: "1. Quiénes somos y alcance de esta política",
    body: "Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026, ofrece esta aplicación de planificación de eventos. Esta política explica el tratamiento de información mediante la aplicación y los procesos relacionados del personal en XOS. Distingue la información que usted introduce en la aplicación de los registros de reservas y clientes que ya tenemos y que mostramos o utilizamos para su evento. Nuestros sitios web, contratos de reserva y servicios de pago externos pueden implicar información y avisos adicionales.",
  },
  {
    heading: "2. Cuentas e inicio de sesión",
    body: "Utilizamos Supabase para autenticar cuentas, gestionar bases de datos y almacenar archivos. Puede iniciar sesión con correo electrónico y contraseña, Google o Apple. Tratamos el correo de su cuenta, identificadores de cuenta y autenticación, la pertenencia y el rol dentro del evento, y los datos de identidad que devuelve el proveedor elegido, que pueden incluir su nombre. Apple puede proporcionar una dirección de retransmisión privada en lugar de su correo personal. Los mensajes de confirmación de correo y restablecimiento de contraseña permiten gestionar el acceso. La aplicación no está diseñada para recopilar su contraseña de Apple o Google. Al servicio de inicio de sesión del proveedor se aplican sus propias condiciones y su aviso de privacidad.",
  },
  {
    heading: "3. Información de reservas y registros del evento",
    body: "Los registros de reservas y gestión de clientes pueden incluir nombre, organización, teléfono, correo electrónico, dirección postal, aniversario, notas, estado y fecha de autorización de SMS, y nombres de usuario opcionales de Instagram o TikTok. Estos registros pueden existir independientemente de una cuenta de la aplicación. La aplicación del anfitrión puede mostrar datos existentes del evento y de la reserva y, cuando esté habilitado, información financiera de solo lectura: paquete, servicios adicionales, desplazamientos, horas extra, descuentos, registros de pagos y calendario de pagos. Mostrar estos registros no significa que se recopilaran originalmente en la aplicación. La aplicación no ofrece pagos con tarjeta, compras dentro de la aplicación ni una suscripción de la aplicación.",
  },
  {
    heading: "4. Contenido de planificación que usted aporta",
    body: "Almacenamos respuestas a preguntas de planificación, selecciones y sugerencias de canciones, títulos y otros metadatos del proveedor, nombres de proveedores y enlaces públicos de música o listas de reproducción, atribución de solicitudes, Me gusta, preferencias de canciones imprescindibles y prohibidas, notas y contenido de la lista de temas o situaciones que se deben evitar. Las notas de cada sección admiten hasta 4.000 caracteres. Las respuestas y otras aportaciones pueden vincularse a un identificador de autor o cuenta. Incluya únicamente lo necesario para planificar el evento. No introduzca contraseñas, números de tarjeta, documentos de identidad ni información sensible innecesaria sobre usted u otras personas en campos o archivos adjuntos.",
  },
  {
    heading: "5. Acceso compartido al evento",
    body: "La planificación es colaborativa. Los anfitriones y el personal pueden acceder al contenido de planificación según sus roles. Los invitados pueden participar en las secciones que el anfitrión haya abierto para ellos. La información financiera, el contenido de la lista de temas o situaciones que se deben evitar y los archivos del planificador reservados al anfitrión están destinados a tener acceso restringido por rol. Lo que aporte a una sección compartida no es un mensaje privado al personal. Evite incluir material confidencial en secciones compartidas y contacte con soporte si observa un acceso incorrecto. Los controles de acceso del evento no convierten en privada la URL pública de una foto de portada.",
  },
  {
    heading: "6. Fotos, archivos e invitaciones",
    body: "Un anfitrión o miembro del personal puede subir una foto de portada. Las portadas se almacenan en el contenedor público event-photos y cualquier persona que tenga la URL puede acceder a ellas, aunque la edición en la aplicación esté restringida. Los PDF y las imágenes del planificador se almacenan por separado en el contenedor privado event-files, con un máximo de 25 MB por archivo, para el personal y los anfitriones autorizados. Cuando un anfitrión invita a alguien, tratamos el nombre, correo y relación de esa persona con el evento para crear y enviar la invitación. Mailgun procesa estos correos y los registros de invitados y de correos se conservan por separado de las cuentas de acceso. Facilite datos de otra persona solo cuando tenga una base adecuada para invitarla e infórmele de que la invitación se refiere a la planificación compartida del evento.",
  },
  {
    heading: "7. Portapapeles e información técnica",
    body: "La aplicación comprueba una vez el portapapeles para ofrecer un enlace de acceso al evento; debe tocar esa opción para unirse. Esta comprobación no solicita su agenda de contactos. Los intentos fallidos de acceso se registran con dirección IP, identificador de usuario y un hash del código de acceso para gestionar el acceso y los abusos. Los proveedores y servidores también pueden tratar registros técnicos de solicitudes y servicios. Esta política no promete la ausencia de todo registro. Un proceso de firma de contratos en la web puede registrar la IP y el agente de usuario; es un proceso web separado, no una recopilación directa mediante una función de firma de contratos de iOS.",
  },
  {
    heading: "8. Para qué utilizamos la información",
    body: "Utilizamos los datos de cuenta y evento para autenticarle, asociarle al evento correcto, guardar y compartir aportaciones, preparar y prestar los servicios reservados, mostrar registros de reserva pertinentes, enviar invitaciones y mensajes operativos, atender consultas e investigar problemas de seguridad o acceso. Los nombres de usuario de redes sociales son opcionales y no se necesitan para la planificación básica. Los SMS de marketing requieren una autorización opcional y separada que no debe agruparse con la aceptación de estas políticas ni con el acceso a la planificación. Los mensajes operativos sobre la cuenta, las invitaciones o la reserva son distintos del marketing. Los textos promocionales son una elección separada, apagada hasta que usted la active, y solo se guardan para el número móvil que ya está en su reserva. Esa elección guarda la hora, la versión del aviso y si vino de la aplicación o de la web. No es permiso para correo electrónico ni para textos de la reserva o de la cuenta. Puede retirarla después en la aplicación. Responder STOP sigue deteniendo los textos a ese número. Si no hay un número móvil en el registro, no guardamos una elección de textos promocionales.",
  },
  {
    heading: "9. Proveedores y contenido externo",
    body: "Además de Supabase, el inicio de sesión de Apple y Google y las invitaciones de Mailgun, las herramientas de música utilizan Spotify, Apple Music, iTunes Search y YouTube para búsquedas de catálogo o consultas de enlaces públicos. El texto de búsqueda o el enlace público de una lista o vídeo pueden enviarse al proveedor correspondiente. Estas herramientas no vinculan su cuenta personal de música y la aplicación no es un servicio de reproducción de canciones completas. TemplatesBooth recibe filtros de catálogo de fotomatón, no la identidad del evento en la consulta revisada. Expo suministra actualizaciones de la aplicación. Los procesos de comunicación del personal pueden utilizar HighLevel y crear o actualizar el nombre, correo y teléfono de un contacto; no es una integración directa de la aplicación del cliente. PayPal está relacionado con el sitio web, no con pagos en iOS. No se ha confirmado que Mailgun sea el proveedor configurado para enviar los correos de autenticación de Supabase.",
  },
  {
    heading: "10. Tratamiento mediante IA del personal",
    body: "Eliminar las recomendaciones de canciones para clientes no elimina la IA del personal. Las herramientas de XOS pueden enviar a OpenAI datos del evento y de planificación para generar resúmenes, responder preguntas y preparar borradores del programa del evento. Según la herramienta, se incluyen nombres, correo, teléfono, lugar y dirección del evento, respuestas, canciones, notas, preferencias de canciones imprescindibles y prohibidas, notas internas y transcripciones de reuniones de Fireflies. Un informe matutino puede incluir nombres del evento o de la pareja, lugares, importes de pagos y fechas de contratos sin firmar. Un asistente del personal también puede recibir contenido pegado por el personal. Son procesos separados y no vinculan cuentas de música. Este aviso no constituye por sí mismo autorización para enviar datos personales a una IA de terceros. Cuando se requiera autorización expresa, debe obtenerse antes de compartirlos. No interprete la aceptación general de políticas ni la invitación de un anfitrión como autorización de IA de otra persona. Las herramientas de IA del personal no envían sus datos personales a OpenAI salvo que usted lo permita para ese evento en la aplicación. Puede retirar esa elección más tarde en la aplicación. Permitirlo puede incluir su nombre, correo, teléfono, lugar y dirección del evento, respuestas de planificación, canciones, notas, preferencias de canciones imprescindibles y prohibidas, notas internas del evento y transcripciones de reuniones. Un informe matutino puede incluir el nombre del evento, el lugar, los importes de pagos y las fechas de contratos sin firmar solo después de ese permiso. Retirarlo detiene el uso posterior de sus datos personales en la IA del personal para ese evento. No deshace un envío que ya se hizo. Su permiso cubre solo a usted y a ese evento. No cubre a un invitado ni a un coanfitrión. Sus datos de contacto y respuestas de texto libre quedan fuera salvo que esa persona tenga su propio permiso. Las transcripciones de llamadas y las notas internas no se envían a OpenAI. El asistente del personal todavía puede recibir texto que un miembro del personal escriba. Los correos y teléfonos en ese chat se rechazan. Un nombre escrito en una frase no queda bloqueado por completo.",
  },
  {
    heading: "11. Otras comunicaciones de datos y publicidad",
    body: "Compartimos información con las personas que participan en su evento y con proveedores según lo descrito. También podemos comunicar información cuando lo exija la legislación aplicable, para responder a solicitudes legales o cuando sea necesario para abordar fraude, abusos o reclamaciones, con las protecciones aplicables. No se identificó un SDK de publicidad o seguimiento entre aplicaciones en el código del cliente revisado. Esto no garantiza las prácticas de cada registro de servidor o proveedor independiente ni acredita condiciones contractuales de proveedores no verificadas. Cualquier recopilación o uso sustancialmente diferente necesita el aviso adecuado y los permisos exigibles.",
  },
  {
    heading: "12. Eliminación",
    body: "Eliminar su cuenta quita el acceso a la aplicación. No podrá volver a entrar con ese acceso. Quitamos el registro de la cuenta de la aplicación, las pertenencias al evento en la aplicación y los tokens de dispositivo de ese acceso. Los detalles de planificación del evento, el registro del invitado, el contrato y los registros de pago permanecen con la reserva para que su DJ pueda realizar el evento y cuando la ley lo exige. Si inició sesión con Apple, intentamos revocar ese acceso. El acceso se elimina aunque esa solicitud falle.",
  },
  {
    heading: "13. Opciones, derechos y seguridad",
    body: "Puede omitir las redes sociales opcionales, elegir qué contenido y archivos apropiados aportar e iniciar la eliminación de su acceso dentro de la aplicación. Puede escribir a drew@xpressdjs.com para solicitar acceso, rectificación, una copia, eliminación de información conservada o retirada de un consentimiento opcional. Los derechos y sus excepciones dependen de la legislación aplicable. Podemos necesitar verificar su identidad y relación con el evento sin solicitar información innecesaria. Los datos de otras personas pueden requerir un tratamiento separado. La retirada no deshace el tratamiento ya realizado ni elimina registros que deban conservarse legalmente. Ningún método de seguridad garantiza la ausencia de accesos no autorizados; no utilice las portadas públicas como almacenamiento seguro.",
  },
  {
    heading: "14. Requisitos de uso y cambios",
    body: "La regla de elegibilidad elegida para la aplicación es tener al menos 18 años; no es una declaración de la clasificación por edades de Apple ni implica una verificación de edad. No aporte información innecesaria sobre menores. Si cree que un menor ha facilitado datos personales mediante la aplicación, contacte con nosotros. Los cambios de esta política se identificarán mediante una fecha de revisión o entrada en vigor cuando se aprueben y publiquen. Un aviso no sustituye la autorización que pueda requerirse para un nuevo uso.",
  },
  {
    heading: "15. Contacto",
    body: "Consultas de privacidad y solicitudes de datos: drew@xpressdjs.com. Ayuda de la aplicación, acceso al evento y denuncias de contenido: events@xpressdjs.com. Dirección postal: Xpress Entertainment Corp, 11280 Pines Blvd, Pembroke Pines FL 33026.",
  },
];

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
    body: "You keep any rights you have in the content you contribute. You give Xpress permission to store, reproduce, display and share that content only as reasonably needed to operate the planning service, collaborate with authorized participants and prepare or provide your event services, subject to the Privacy Policy and applicable permissions. This is not a general license to sell your content, use it in public advertising, train AI, or bypass a required AI opt-in. Only upload materials you have the right to provide and share. Obtain appropriate permission before providing other people's information, photographs or documents.",
  },
  {
    heading: "5. Appropriate use and reports",
    body: "Do not post unlawful, threatening, harassing, hateful, exploitative, sexually abusive or infringing content; impersonate someone; spam invitations; upload malicious files; probe accounts or storage without authorization; or try to bypass event roles or security. Do not expose another person's confidential information. Send content or access concerns to events@xpressdjs.com with the event and enough detail to identify the issue, without forwarding unnecessary sensitive material. Xpress may review reports and restrict access or remove content to address misuse, safety, rights or legal requirements. This statement does not claim that in-app reporting, blocking or automated content filtering tools already exist.",
  },
  {
    heading: "6. Photos, documents and music",
    body: "Cover photos use public URLs and must not contain confidential material. Planner PDFs and images use separate private storage and are intended for authorized hosts and staff. Supported planner uploads are limited to 25 MB per file. Music search and public-link features rely on external catalogs and do not connect your personal music-service account. This app is for planning, not full-song streaming or transferring music ownership or performance rights. Third-party content, availability and links can change, and the providers' terms apply to their services.",
  },
  {
    heading: "7. Communications and privacy",
    body: "We use account, event and planning information as described in the Privacy Policy. Invitations and booking or account communications are distinct from optional marketing. Marketing SMS permission must be separate and optional, not a condition of using planning or accepting these Terms. Optional social handles can be skipped. Staff AI processing is a separate issue described in the Privacy Policy and proposed separate authorization. Accepting these Terms is not explicit permission for third-party AI processing.",
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
    body: "Usted conserva los derechos que tenga sobre el contenido que aporta. Autoriza a Xpress a almacenar, reproducir, mostrar y compartir ese contenido únicamente en la medida razonablemente necesaria para operar la planificación, colaborar con participantes autorizados y preparar o prestar los servicios del evento, con sujeción a la Política de privacidad y a los permisos aplicables. No es una licencia general para vender su contenido, usarlo en publicidad pública, entrenar IA o eludir una autorización de IA exigible. Suba solo materiales que tenga derecho a facilitar y compartir. Obtenga los permisos adecuados antes de aportar datos, fotos o documentos de otras personas.",
  },
  {
    heading: "5. Uso adecuado y avisos",
    body: "No publique contenido ilícito, amenazante, de acoso, de odio, de explotación, de abuso sexual o que infrinja derechos; no suplante identidades; no envíe invitaciones masivas no deseadas; no suba archivos maliciosos; no explore cuentas o almacenamiento sin autorización; ni intente eludir roles o seguridad. No exponga información confidencial ajena. Informe de problemas de contenido o acceso a events@xpressdjs.com, indicando el evento y detalles suficientes para identificar el problema, sin reenviar material sensible innecesario. Xpress podrá revisar avisos y restringir accesos o retirar contenido para abordar usos indebidos, seguridad, derechos u obligaciones legales. Esto no afirma que ya existan herramientas dentro de la aplicación para denunciar, bloquear o filtrar contenido automáticamente.",
  },
  {
    heading: "6. Fotos, documentos y música",
    body: "Las portadas utilizan URL públicas y no deben contener material confidencial. Los PDF y las imágenes del planificador usan almacenamiento privado separado y están destinados a anfitriones autorizados y personal. Los archivos del planificador admitidos tienen un máximo de 25 MB cada uno. Las búsquedas de música y los enlaces públicos dependen de catálogos externos y no conectan su cuenta personal de música. La aplicación sirve para planificar, no para reproducir canciones completas ni transferir derechos de propiedad o ejecución musical. El contenido, la disponibilidad y los enlaces de terceros pueden cambiar, y a sus servicios se aplican sus propias condiciones.",
  },
  {
    heading: "7. Comunicaciones y privacidad",
    body: "Utilizamos los datos de cuenta, evento y planificación según la Política de privacidad. Las invitaciones y comunicaciones de reserva o cuenta son distintas del marketing opcional. La autorización de SMS de marketing debe ser separada y opcional, no una condición para planificar o aceptar estas Condiciones. Puede omitir las redes sociales opcionales. El tratamiento mediante IA del personal es una cuestión separada descrita en la Política de privacidad y en la propuesta de autorización independiente. Aceptar estas Condiciones no constituye autorización expresa para el tratamiento mediante IA de terceros.",
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
      title: "Privacy Policy",
      description: "Privacy policy for the Xpress Entertainment client event-planning app.",
      navLabel: "Privacy Policy",
      sections: privacyEn,
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
      title: "Política de privacidad",
      description: "Política de privacidad de la aplicación de planificación de eventos de Xpress Entertainment.",
      navLabel: "Política de privacidad",
      sections: privacyEs,
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

export function policyPlainText(id: PolicyDocId, lang: PolicyLang): string {
  const doc = APP_POLICIES[lang][id];
  return [doc.title, doc.lead ?? "", ...doc.sections.flatMap((section) => [section.heading, section.body])]
    .filter(Boolean)
    .join("\n");
}
