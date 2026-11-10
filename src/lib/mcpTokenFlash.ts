/** One-time secret flash for mint/rotate. Kept free of Next imports so tests can
    exercise the insert → return → acknowledge order without remounting a form. */

export type TokenFlash = { token: string; prefix: string; name: string } | { error: string } | null;

export type MintedToken = { raw: string; prefix: string; hash: string };

export type TokenFlashStore = {
  insert(row: {
    name: string;
    token_prefix: string;
    token_hash: string;
    scopes: string[];
    expires_at: string | null;
    created_by: string | null;
    note: string | null;
    rotated_from_id?: string | null;
  }): Promise<{ id: string } | { error: string }>;
  setOverlap(id: string, overlapUntil: string): Promise<{ error: string | null }>;
  revoke(id: string, at: string): Promise<{ error: string | null }>;
};

function fail(error: unknown, fallback: string): TokenFlash {
  return { error: error instanceof Error ? error.message : fallback };
}

/** After the row is inserted, return the secret without refreshing the page.
    A page refresh (revalidatePath) remounts the mint form and drops useActionState,
    so the secret never appears and the button can look stuck on Creating….
    If anything after insert throws, revoke the row so a secretless token is not left active. */
export async function completeMintedToken(
  store: TokenFlashStore,
  insertedId: string,
  flash: { token: string; prefix: string; name: string },
  afterInsert?: () => Promise<void>,
): Promise<TokenFlash> {
  try {
    if (afterInsert) await afterInsert();
    return flash;
  } catch (error) {
    const at = new Date().toISOString();
    const revoked = await store.revoke(insertedId, at);
    if (revoked.error) {
      return {
        error: "The token was created but could not be shown, and revoking it failed. Revoke it from the list before minting again.",
      };
    }
    return fail(error, "The token was created but could not be shown, so it was revoked. Try again.");
  }
}

export async function mintTokenFlash(
  store: TokenFlashStore,
  input: {
    name: string;
    scopes: string[];
    expiresAt: string | null;
    note: string | null;
    createdBy: string | null;
    minted: MintedToken;
  },
): Promise<TokenFlash> {
  const created = await store.insert({
    name: input.name,
    token_prefix: input.minted.prefix,
    token_hash: input.minted.hash,
    scopes: input.scopes,
    expires_at: input.expiresAt,
    created_by: input.createdBy,
    note: input.note,
  });
  if ("error" in created) return { error: created.error };
  return completeMintedToken(store, created.id, {
    token: input.minted.raw,
    prefix: input.minted.prefix,
    name: input.name,
  });
}

export async function rotateTokenFlash(
  store: TokenFlashStore,
  input: {
    oldId: string;
    name: string;
    scopes: string[];
    expiresAt: string | null;
    note: string | null;
    createdBy: string | null;
    overlapUntil: string;
    minted: MintedToken;
  },
): Promise<TokenFlash> {
  const created = await store.insert({
    name: input.name,
    token_prefix: input.minted.prefix,
    token_hash: input.minted.hash,
    scopes: input.scopes,
    expires_at: input.expiresAt,
    created_by: input.createdBy,
    note: input.note,
    rotated_from_id: input.oldId,
  });
  if ("error" in created) return { error: created.error };
  return completeMintedToken(
    store,
    created.id,
    { token: input.minted.raw, prefix: input.minted.prefix, name: input.name },
    async () => {
      const overlap = await store.setOverlap(input.oldId, input.overlapUntil);
      if (overlap.error) {
        throw new Error("Rotation did not finish. The new token was revoked and the old token is unchanged.");
      }
    },
  );
}
