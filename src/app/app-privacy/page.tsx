import type { Metadata } from "next";
import { AppPolicyDocument } from "@/components/AppPolicyDocument";
import { APP_POLICIES, policyLang } from "@/lib/appPolicies";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const lang = policyLang((await searchParams).lang);
  const doc = APP_POLICIES[lang].privacy;
  return { title: `${doc.title} — Xpress Entertainment App`, description: doc.description, robots: { index: true, follow: true } };
}

export default async function AppPrivacyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = policyLang((await searchParams).lang);
  return <AppPolicyDocument id="privacy" lang={lang} />;
}
