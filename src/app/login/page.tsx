"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { faApple, faGoogle } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import AuthShell from "@/components/AuthShell";
import PasskeyLogin from "@/components/PasskeyLogin";
import { cancelPasskeyCeremony } from "@/lib/passkeyBrowser";
import { createClient } from "@/lib/supabase/client";
import { safeStaffNext, staffCallbackUrl } from "@/lib/staffSso";

type Step = "choices" | "email";

const ERRORS: Record<string, string> = {
  "not-staff": "That Google or Apple account is not an XOS staff login.",
  sso: "Google or Apple sign-in did not finish. Check the provider setup and try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choices");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("error");
    return code && ERRORS[code] ? ERRORS[code] : null;
  });
  const [loading, setLoading] = useState(false);

  function goChoices() {
    cancelPasskeyCeremony();
    setStep("choices");
    setError(null);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    cancelPasskeyCeremony();
    const supabase = createClient();
    const { data: signIn, error: signError } = await supabase.auth.signInWithPassword({ email, password });
    if (signError) {
      setError(signError.message);
      setLoading(false);
      return;
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const emailMfa = signIn.user?.app_metadata?.email_mfa === true;
    const passkeyMfa = signIn.user?.app_metadata?.passkey_mfa === true;
    const next = safeStaffNext(new URLSearchParams(window.location.search).get("next"));
    const needsSecondFactor =
      (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") ||
      ((emailMfa || passkeyMfa) && aal?.currentLevel !== "aal2");
    if (needsSecondFactor) {
      router.push(next ? `/2fa?next=${encodeURIComponent(next)}` : "/2fa");
      return;
    }
    if (next) {
      window.location.assign(next);
      return;
    }
    window.location.assign(await landingFor(signIn.user?.id));
  }

  async function afterPasskey() {
    const next = safeStaffNext(new URLSearchParams(window.location.search).get("next"));
    if (next) {
      window.location.assign(next);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    window.location.assign(await landingFor(data.user?.id));
  }

  async function startSso(provider: "google" | "apple") {
    setError(null);
    setLoading(true);
    cancelPasskeyCeremony();
    const next = safeStaffNext(new URLSearchParams(window.location.search).get("next"));
    const redirectTo = staffCallbackUrl(window.location.origin, next);
    if (!redirectTo) {
      setError("This address cannot start Google or Apple sign-in.");
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: false },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="XOS · Xpress Operating System">
      {step === "choices" ? (
        <div className="space-y-3" role="group" aria-label="Sign in">
          <PasskeyLogin choice onSignedIn={afterPasskey} />
          <ChoiceButton label="Email" onClick={() => { setError(null); setStep("email"); }} />
          <ChoiceButton label="Google" icon={faGoogle} disabled={loading} onClick={() => void startSso("google")} />
          <ChoiceButton label="Apple" icon={faApple} disabled={loading} onClick={() => void startSso("apple")} />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <p className="text-center text-xs text-zinc-500">Staff sign-in. A passkey finishes on its own. Google and Apple still ask for your passkey or verification code.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <button type="button" onClick={goChoices} className="mb-4 text-sm font-semibold text-brand hover:underline dark:text-brand-lighter">
            Back
          </button>
          <label className="label-xs" htmlFor="staff-email">Email</label>
          <input
            id="staff-email"
            type="email"
            required
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mb-4 w-full"
          />
          <label className="label-xs" htmlFor="staff-password">Password</label>
          <input
            id="staff-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mb-5 w-full"
          />
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? "Signing in…" : "Log On"}
          </button>
          <Link href="/auth/forgot-password" className="mt-4 block w-full text-center text-xs text-zinc-500 hover:underline">
            Forgot password?
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

function ChoiceButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: typeof faGoogle;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-ghost flex w-full items-center justify-center gap-2 disabled:opacity-50">
      {icon ? <FontAwesomeIcon icon={icon} className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

async function landingFor(userId: string | undefined): Promise<string> {
  const supabase = createClient();
  let landing = "/";
  const { data: emp } = userId
    ? await supabase.from("employees").select("permission_tier, landing_page").eq("auth_user_id", userId).maybeSingle()
    : { data: null };
  if (emp?.landing_page) return emp.landing_page;
  const role = emp?.permission_tier || "master_admin";
  const { data: rs } = await supabase.from("role_settings").select("landing_page").eq("role", role).maybeSingle();
  if (rs?.landing_page) return rs.landing_page;
  const { data: cs } = await supabase.from("company_settings").select("landing_page").eq("id", true).maybeSingle();
  landing = cs?.landing_page || "/";
  return landing;
}
