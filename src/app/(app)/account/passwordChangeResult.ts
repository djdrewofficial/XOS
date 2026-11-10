export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; error: string; needsNonce?: boolean; needsMfa?: boolean };
