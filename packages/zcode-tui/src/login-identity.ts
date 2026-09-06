import { readLoginIdentitySnapshot } from "../../../src/identity.ts";

/** How the active provider authenticates, as shown in the banner and status line. */
export interface LoginIdentity {
  kind: "oauth" | "named" | "apiKey" | "signedOut";
  /** OAuth account name, a key-mapped name, or the masked API key. */
  label: string;
  /** Masked key for the "named" kind — keeps the display distinguishable across accounts. */
  keyMasked?: string;
}

/**
 * Delegates to `src/identity.ts` — one implementation, no mirror drift. The
 * stored OAuth login is the primary signal, so a `/login` round-trip is
 * reflected immediately even while a custom-provider file still configures
 * the model; without a login the identity is "not signed in" whenever model
 * access exists, and undefined when nothing is configured (the banner turns
 * that undefined into "Not signed in" so the state stays visible).
 */
export async function readLoginIdentity(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoginIdentity | undefined> {
  const snapshot = await readLoginIdentitySnapshot(env).catch(() => undefined);
  if (!snapshot) return undefined;
  return { kind: snapshot.kind, label: snapshot.label, ...(snapshot.keyMasked ? { keyMasked: snapshot.keyMasked } : {}) };
}

/**
 * Banner text for the identity line: "Signed in as alice" for an OAuth
 * account (the one identity the system truly knows), "API key <name>
 * (<masked>)" / "API key 916c…e2f1" for key sign-ins — a mapped name is a
 * user-chosen alias two accounts can share, so the masked key rides along —
 * and "Not signed in" otherwise.
 */
export function loginIdentityText(identity: LoginIdentity): string {
  if (identity.kind === "signedOut") return "Not signed in";
  if (identity.kind === "oauth") return `Signed in as ${identity.label}`;
  if (identity.kind === "named" && identity.keyMasked) return `API key ${identity.label} (${identity.keyMasked})`;
  return `API key ${identity.label}`;
}

/**
 * BigModel login commands: neither the OAuth flow nor the pasted-key variant
 * ever learns the account name (the upstream runtime discards it), so the
 * user name is collected up front and bound to the landed key after the
 * login. Z.AI logins are excluded — the OAuth flow stores the account name
 * itself.
 */
export function shouldPromptForLoginUserName(command: string): boolean {
  return /^\/login\s+bigmodel-coding-plan(?:-api-key)?(?:\s|$)/u.test(command);
}
