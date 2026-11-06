/**
 * What the staff sign-in gate should do.
 *
 * Authenticator and text codes are Supabase factors. Verifying one raises the
 * session to aal2, and `currentLevel === "aal2"` is enough on its own.
 *
 * Email is not a Supabase factor. A signed, session-bound cookie set only after
 * a single-use email code is the email proof.
 *
 * A passkey is not a Supabase factor either. Signing in with one (or confirming
 * one for the current session) sets the same kind of cookie. That proof is
 * enough by itself, even when an authenticator or text code is also enrolled.
 * Password plus a code still has to reach aal2 or the email proof.
 *
 * A staff account with none of these is sent to enroll one before using XOS.
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
  passkeyEnrolled: boolean;
  /** Cookie signature, user, and session id all matched for a passkey ceremony. */
  passkeyStepUp: boolean;
  roleRequiresMfa: boolean;
}): MfaGateDecision {
  const emailOk = input.emailEnrolled && input.emailStepUp;
  // A passkey ceremony already verified this person. No second code.
  if (input.passkeyStepUp) return "allow";
  if (!input.aalKnown) {
    if (input.emailEnrolled && !emailOk) return "challenge";
    if (input.passkeyEnrolled) return "challenge";
    return "allow";
  }
  const supabaseFactor = input.nextLevel === "aal2";
  const supabaseOk = input.currentLevel === "aal2";
  const enrolled = supabaseFactor || input.emailEnrolled || input.passkeyEnrolled;
  const satisfied = supabaseOk || emailOk;
  if (enrolled && !satisfied) return "challenge";
  if (!enrolled && input.roleRequiresMfa) return "enroll";
  return "allow";
}
