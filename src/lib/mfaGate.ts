/**
 * What the staff 2FA gate should do.
 *
 * Authenticator and text codes are Supabase factors. Verifying one raises the
 * session to aal2, and `currentLevel === "aal2"` is enough on its own.
 *
 * Email is not a Supabase factor. Auth will not mint an aal2 session for it,
 * and this gate does not pretend otherwise (it does not write auth.sessions or
 * an authenticator AMR claim). A signed, session-bound cookie set only after
 * a single-use email code is the email proof. Either proof satisfies the gate.
 */
export type MfaGateDecision = "allow" | "challenge" | "enroll";

export function decideMfaGate(input: {
  /** False when the assurance lookup failed. The gate then fails open, except
      an email factor we already know about still has to be answered. */
  aalKnown: boolean;
  currentLevel: string | null | undefined;
  nextLevel: string | null | undefined;
  emailEnrolled: boolean;
  /** Cookie signature, user, and session id all matched. */
  emailStepUp: boolean;
  roleRequiresMfa: boolean;
}): MfaGateDecision {
  const emailOk = input.emailEnrolled && input.emailStepUp;
  if (!input.aalKnown) {
    if (input.emailEnrolled && !emailOk) return "challenge";
    return "allow";
  }
  const supabaseFactor = input.nextLevel === "aal2";
  const supabaseOk = input.currentLevel === "aal2";
  const enrolled = supabaseFactor || input.emailEnrolled;
  const satisfied = supabaseOk || emailOk;
  if (enrolled && !satisfied) return "challenge";
  if (!enrolled && input.roleRequiresMfa) return "enroll";
  return "allow";
}
