import {
  APP_POLICIES,
  APP_POLICY_ADDRESS,
  APP_POLICY_ENTITY,
  APP_POLICY_PRIVACY_EMAIL,
  APP_POLICY_SUPPORT_EMAIL,
  linkPolicyText,
  policyHref,
  type PolicyBlock,
  type PolicyDocId,
  type PolicyLang,
  type PolicyListItem,
  type PolicySection,
} from "@/lib/appPolicies";

const DOC_ORDER: PolicyDocId[] = ["privacy", "terms", "deletion"];

const linkClass = "text-violet-700 underline dark:text-violet-400";

function ListItem({ item }: { item: PolicyListItem }) {
  if (typeof item === "string") return <li>{item}</li>;
  return (
    <li>
      <strong className="font-semibold text-neutral-900 dark:text-white">{item.lead}</strong> {item.text}
    </li>
  );
}

function Block({ block, lang, id }: { block: PolicyBlock; lang: PolicyLang; id: PolicyDocId }) {
  if (block.type === "p") {
    const text = block.lead ? `${block.lead} ${block.text}` : block.text;
    return (
      <p className="mt-3 leading-relaxed">
        {block.lead ? (
          <>
            <strong className="font-semibold text-neutral-900 dark:text-white">{block.lead}</strong>{" "}
            {linkPolicyText(block.text, lang, id).map((part, index) =>
              part.href ? (
                <a key={index} className={linkClass} href={part.href}>
                  {part.text}
                </a>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </>
        ) : (
          linkPolicyText(text, lang, id).map((part, index) =>
            part.href ? (
              <a key={index} className={linkClass} href={part.href}>
                {part.text}
              </a>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )
        )}
      </p>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
        {block.items.map((item, index) => (
          <ListItem key={index} item={item} />
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-left text-sm leading-relaxed">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-700">
            <th className="py-2 pr-4 font-semibold text-neutral-900 dark:text-white">{block.columns[0]}</th>
            <th className="py-2 font-semibold text-neutral-900 dark:text-white">{block.columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index} className="border-b border-neutral-100 dark:border-neutral-800">
              <td className="py-2 pr-4 align-top">{row[0]}</td>
              <td className="py-2 align-top">{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBody({ section, lang, id }: { section: PolicySection; lang: PolicyLang; id: PolicyDocId }) {
  if (section.blocks?.length) {
    return (
      <>
        {section.blocks.map((block, index) => (
          <Block key={index} block={block} lang={lang} id={id} />
        ))}
      </>
    );
  }
  if (!section.body) return null;
  return (
    <p className="mt-3 leading-relaxed">
      {linkPolicyText(section.body, lang, id).map((part, index) =>
        part.href ? (
          <a key={`${section.heading}-${index}`} className={linkClass} href={part.href}>
            {part.text}
          </a>
        ) : (
          <span key={`${section.heading}-${index}`}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function AppPolicyDocument({ id, lang }: { id: PolicyDocId; lang: PolicyLang }) {
  const doc = APP_POLICIES[lang][id];
  const other = lang === "es" ? "en" : "es";
  return (
    <main lang={lang} className="mx-auto max-w-3xl px-5 py-12 text-neutral-800 dark:text-neutral-200">
      <nav aria-label={lang === "es" ? "Idioma" : "Language"} className="flex gap-3 text-sm">
        <a
          href={policyHref(id, "en")}
          hrefLang="en"
          lang="en"
          aria-current={lang === "en" ? "true" : undefined}
          className={lang === "en" ? "font-semibold text-neutral-900 underline dark:text-white" : linkClass}
        >
          English
        </a>
        <a
          href={policyHref(id, "es")}
          hrefLang="es"
          lang="es"
          aria-current={lang === "es" ? "true" : undefined}
          className={lang === "es" ? "font-semibold text-neutral-900 underline dark:text-white" : linkClass}
        >
          Español
        </a>
      </nav>

      <nav aria-label={lang === "es" ? "Documentos de la aplicación" : "App documents"} className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {DOC_ORDER.map((docId) => {
          const item = APP_POLICIES[lang][docId];
          const current = docId === id;
          return (
            <a
              key={docId}
              href={policyHref(docId, lang)}
              aria-current={current ? "page" : undefined}
              className={current ? "font-semibold text-neutral-900 dark:text-white" : linkClass}
            >
              {item.navLabel}
            </a>
          );
        })}
      </nav>

      <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">{doc.title}</h1>
      {doc.preamble?.length ? (
        <div className="mt-2 space-y-1 text-sm text-neutral-500 dark:text-neutral-400">
          {doc.preamble.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {APP_POLICY_ENTITY}
          <span aria-hidden="true"> · </span>
          {APP_POLICY_ADDRESS}
        </p>
      )}

      {doc.lead ? <p className="mt-6 leading-relaxed">{doc.lead}</p> : null}

      {doc.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{section.heading}</h2>
          <SectionBody section={section} lang={lang} id={id} />
        </section>
      ))}

      <section className="mt-10 border-t border-neutral-200 pt-6 text-sm leading-relaxed dark:border-neutral-700">
        <p>
          {lang === "es" ? "Privacidad" : "Privacy"}:{" "}
          <a className={linkClass} href={`mailto:${APP_POLICY_PRIVACY_EMAIL}`}>
            {APP_POLICY_PRIVACY_EMAIL}
          </a>
        </p>
        <p className="mt-1">
          {lang === "es" ? "Soporte" : "Support"}:{" "}
          <a className={linkClass} href={`mailto:${APP_POLICY_SUPPORT_EMAIL}`}>
            {APP_POLICY_SUPPORT_EMAIL}
          </a>
        </p>
        <p className="mt-1">
          <a className={linkClass} href={policyHref(id, other)} hrefLang={other} lang={other}>
            {other === "es" ? "Leer en español" : "Read in English"}
          </a>
        </p>
      </section>
    </main>
  );
}
