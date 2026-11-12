import type { Metadata } from "next";
import { APP_POLICY_SUPPORT_EMAIL } from "@/lib/appPolicies";
import { APP_SUPPORT, supportHref, supportLang } from "@/lib/appSupport";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const lang = supportLang((await searchParams).lang);
  const doc = APP_SUPPORT[lang];
  return {
    title: `${doc.title} | Xpress DJs`,
    description: doc.description,
    robots: { index: true, follow: true },
  };
}

const linkClass = "text-violet-700 underline dark:text-violet-400";

export default async function AppSupportPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = supportLang((await searchParams).lang);
  const doc = APP_SUPPORT[lang];
  const other = lang === "es" ? "en" : "es";

  return (
    <main lang={lang} className="mx-auto max-w-3xl px-5 py-12 text-neutral-800 dark:text-neutral-200">
      <nav aria-label={lang === "es" ? "Idioma" : "Language"} className="flex gap-3 text-sm">
        <a
          href={supportHref("en")}
          hrefLang="en"
          lang="en"
          aria-current={lang === "en" ? "true" : undefined}
          className={lang === "en" ? "font-semibold text-neutral-900 underline dark:text-white" : linkClass}
        >
          English
        </a>
        <a
          href={supportHref("es")}
          hrefLang="es"
          lang="es"
          aria-current={lang === "es" ? "true" : undefined}
          className={lang === "es" ? "font-semibold text-neutral-900 underline dark:text-white" : linkClass}
        >
          Español
        </a>
      </nav>

      <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">{doc.title}</h1>
      <p className="mt-4 leading-relaxed">{doc.intro}</p>

      {doc.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{section.heading}</h2>
          <p className="mt-3 leading-relaxed">
            {section.body.includes(APP_POLICY_SUPPORT_EMAIL)
              ? section.body.split(APP_POLICY_SUPPORT_EMAIL).flatMap((chunk, index, parts) => {
                  const nodes = [<span key={`t-${index}`}>{chunk}</span>];
                  if (index < parts.length - 1) {
                    nodes.push(
                      <a key={`m-${index}`} className={linkClass} href={`mailto:${APP_POLICY_SUPPORT_EMAIL}`}>
                        {APP_POLICY_SUPPORT_EMAIL}
                      </a>,
                    );
                  }
                  return nodes;
                })
              : section.body}
          </p>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white">
          {lang === "es" ? "Privacidad" : "Privacy"}
        </h2>
        <p className="mt-3 leading-relaxed">
          <a className={linkClass} href={doc.privacyHref}>
            {doc.privacyLabel}
          </a>
        </p>
      </section>

      <p className="mt-10 text-sm">
        <a className={linkClass} href={supportHref(other)} hrefLang={other} lang={other}>
          {other === "es" ? "Leer en español" : "Read in English"}
        </a>
      </p>
    </main>
  );
}
