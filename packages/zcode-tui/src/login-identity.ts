import { readLoginIdentitySnapshot } from "../../../src/identity.ts";

/** How the active provider authenticates, as shown in the banner and status line. */
export interface LoginIdentity {
  kind: "oauth" | "named" | "apiKey" | "signedOut";
  /** OAuth account name, a key-mapped name, or the masked API key. */
  label: string;
}

/**
 * Delegates to `src/identity.ts` — one implementation, no mirror drift. The
 * stored OAuth login is the primary signal, so a `/login` round-trip is
 * reflected immediately even while a custom-provider file still configures
 * the model; without a login the identity is "not signed in" whenever model
 * access exists, and undefined when nothing is configured (the login wizard
 * warning covers that state).
 */
export async function readLoginIdentity(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoginIdentity | undefined> {
  const snapshot = await readLoginIdentitySnapshot(env).catch(() => undefined);
  if (!snapshot) return undefined;
  return { kind: snapshot.kind, label: snapshot.label };
}

/** Banner text for the identity line, e.g. "Signed in as alice", "API key 916c…e2f1" or "Not signed in". */
export function loginIdentityText(identity: LoginIdentity): string {
  if (identity.kind === "signedOut") return "Not signed in";
  return identity.kind === "apiKey" ? `API key ${identity.label}` : `Signed in as ${identity.label}`;
}
