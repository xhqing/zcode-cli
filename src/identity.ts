import { readFile, writeFile } from "node:fs/promises";
import type { Writable } from "node:stream";

import { bigmodelUsersPath, resolveBigmodelUserName } from "./bigmodel-users.ts";
import { displayProviderId } from "./env-config.ts";
import { updateUserConfig, userConfigPath } from "./model-access.ts";
import { credentialsFilePath, decryptCredential, encryptCredential, maskApiKey } from "./usage.ts";

/** OAuth providers whose account name lives in the credential vault. */
const oauthProviderIds = new Set(["zai", "bigmodel"]);

export type OAuthProviderId = "zai" | "bigmodel";

const maxLabelWidth = 24;
const maxNameLength = 64;

interface UserConfigShape {
  model?: { main?: unknown };
  provider?: Record<string, { options?: { apiKey?: unknown } } | undefined>;
}

interface StoredUserInfo {
  username?: unknown;
  displayName?: unknown;
  [key: string]: unknown;
}

type CredentialVault = Record<string, string>;

function identityLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim().slice(0, maxLabelWidth);
  return label || undefined;
}

async function readVault(env: NodeJS.ProcessEnv): Promise<CredentialVault> {
  return JSON.parse(await readFile(credentialsFilePath(env), "utf8")) as CredentialVault;
}

async function writeVault(vault: CredentialVault, env: NodeJS.ProcessEnv): Promise<void> {
  await writeFile(credentialsFilePath(env), JSON.stringify(vault, null, 2) + "\n", { mode: 0o600 });
}

/** The provider the sign-in identity belongs to: the vault marker wins, then the configured main model. */
async function activeProviderId(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const vault = await readVault(env);
    const marker = vault["oauth:active_provider"];
    if (typeof marker === "string" && marker) {
      const provider = decryptCredential(marker, env).trim();
      if (provider) return provider;
    }
  } catch {
    // No vault or unreadable marker: fall through to the config lookup.
  }
  try {
    const config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
    const model = typeof config.model?.main === "string" ? config.model.main.trim() : "";
    const separator = model.indexOf("/");
    if (separator > 0) return model.slice(0, separator);
  } catch {
    // No config: fall through to the default.
  }
  return "bigmodel";
}

/**
 * The provider with a stored OAuth login, if any. The vault marker (when it
 * names a provider that also has an access token) wins; otherwise a scan for
 * either provider's access token. Presence of a token is the login signal —
 * expiry/refusal is the runtime's business, not ours.
 */
export async function readStoredOAuthLogin(
  env: NodeJS.ProcessEnv = process.env
): Promise<OAuthProviderId | undefined> {
  let vault: CredentialVault;
  try {
    vault = await readVault(env);
  } catch {
    return undefined;
  }
  const hasToken = (provider: string): boolean => {
    const token = vault[`oauth:${provider}:access_token`];
    return typeof token === "string" && token.length > 0;
  };
  try {
    const marker = vault["oauth:active_provider"];
    if (typeof marker === "string" && marker) {
      const provider = decryptCredential(marker, env).trim();
      if ((provider === "zai" || provider === "bigmodel") && hasToken(provider)) return provider;
    }
  } catch {
    // Unreadable marker: fall through to the plain token scan.
  }
  for (const provider of ["zai", "bigmodel"] as const) {
    if (hasToken(provider)) return provider;
  }
  return undefined;
}

/**
 * The official provider slot holding an API key, if any. The slot the model
 * selection points at wins; otherwise a zai-first scan (matching the vault
 * token-scan order). A key in an official slot is a sign-in too — the `/login`
 * API-key variants paste it there.
 */
function officialProviderWithKeyIn(config: UserConfigShape | undefined): OAuthProviderId | undefined {
  const hasKey = (providerId: string): boolean => {
    const apiKey = config?.provider?.[providerId]?.options?.apiKey;
    return typeof apiKey === "string" && apiKey.trim().length > 0;
  };
  const model = typeof config?.model?.main === "string" ? config.model.main.trim() : "";
  const separator = model.indexOf("/");
  const mainProvider = separator > 0 ? model.slice(0, separator) : "";
  if ((mainProvider === "zai" || mainProvider === "bigmodel") && hasKey(mainProvider)) {
    return mainProvider;
  }
  for (const providerId of ["zai", "bigmodel"] as const) {
    if (hasKey(providerId)) return providerId;
  }
  return undefined;
}

/**
 * The provider the sign-in state belongs to: a stored OAuth login (vault
 * access token) first, then a key in an official provider slot — a pasted
 * API key is a sign-in too, it just shows a key identity instead of an
 * account name. Returns undefined only when neither exists, which leaves
 * custom-provider-slot access (or nothing at all) — the signed-out state.
 */
export async function readSignedInProvider(
  env: NodeJS.ProcessEnv = process.env
): Promise<OAuthProviderId | undefined> {
  const oauth = await readStoredOAuthLogin(env);
  if (oauth) return oauth;
  try {
    const config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
    return officialProviderWithKeyIn(config);
  } catch {
    return undefined;
  }
}

export interface LoginIdentitySnapshot {
  /** Display-facing provider id: the `env-` slot prefix is already stripped. */
  providerId: string;
  kind: "oauth" | "named" | "apiKey" | "signedOut";
  label: string;
  /**
   * Masked key for the "named" kind. A key-mapped label is a user-chosen
   * alias, not an account identity — two accounts can share one — so the
   * masked key rides along to keep the display distinguishable after an
   * account switch.
   */
  keyMasked?: string;
}

/**
 * Resolves the sign-in identity the TUI banner/status line and `zcode identity`
 * show. Sign-in has two tiers: a stored OAuth login (vault access token) shows
 * the account identity — the account-name snapshot, then (BigModel) the
 * key-mapped name, then the masked API key — regardless of which provider
 * entry `model.main` currently points at, so a `/login` round-trip is
 * reflected immediately even while a custom-provider file still configures
 * the model. Without a token, a key in an official provider slot (what the
 * `/login` API-key variants paste) is a sign-in too and shows the key
 * identity (mapped name, then the masked key). Only custom-provider-slot
 * access remains "not signed in"; with no access at all the login wizard
 * warning covers the state and undefined is returned.
 */
export async function readLoginIdentitySnapshot(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoginIdentitySnapshot | undefined> {
  const oauthProvider = await readStoredOAuthLogin(env);

  let config: UserConfigShape | undefined;
  try {
    config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
  } catch {
    config = undefined;
  }

  const signedInProvider = oauthProvider ?? officialProviderWithKeyIn(config);
  if (signedInProvider) {
    if (oauthProvider) {
      try {
        const vault = await readVault(env);
        const stored = vault[`oauth:${oauthProvider}:user_info`];
        if (typeof stored === "string" && stored) {
          const userInfo = JSON.parse(decryptCredential(stored, env)) as StoredUserInfo;
          const label = identityLabel(userInfo.displayName) ?? identityLabel(userInfo.username);
          if (label) return { providerId: oauthProvider, kind: "oauth", label };
        }
      } catch {
        // Missing vault entry or unreadable credential: fall through to the key.
      }
    }
    const provider = config?.provider?.[signedInProvider];
    const apiKey = typeof provider?.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
    if (apiKey) {
      if (signedInProvider === "bigmodel") {
        const label = identityLabel(await resolveBigmodelUserName(apiKey, env));
        if (label) return { providerId: signedInProvider, kind: "named", label, keyMasked: maskApiKey(apiKey) };
      }
      return { providerId: signedInProvider, kind: "apiKey", label: maskApiKey(apiKey) };
    }
    // Logged in but no exchanged key in the config slot: still signed in —
    // fall back to the provider name rather than the "not signed in" state.
    return { providerId: signedInProvider, kind: "oauth", label: displayProviderId(signedInProvider) };
  }

  // Not signed in: show the state itself whenever model access exists.
  const model = typeof config?.model?.main === "string" ? config.model.main.trim() : "";
  const separator = model.indexOf("/");
  const provider = separator > 0 ? config?.provider?.[model.slice(0, separator)] : undefined;
  const apiKey = typeof provider?.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
  if (!apiKey) return undefined;
  return { providerId: displayProviderId(model.slice(0, separator)), kind: "signedOut", label: "" };
}

export interface BigModelKeyNameHint {
  apiKeyMasked: string;
  usersPath: string;
}

/**
 * Present when the active provider is BigModel and its identity resolves to the
 * masked API key with no mapped name — the state where adding the key to
 * `bigmodel-users.json` would upgrade the display. Login flows and the
 * identity command use it to point users at the mapping file.
 */
export async function readBigModelKeyNameHint(
  env: NodeJS.ProcessEnv = process.env
): Promise<BigModelKeyNameHint | undefined> {
  const identity = await readLoginIdentitySnapshot(env).catch(() => undefined);
  if (!identity || identity.providerId !== "bigmodel" || identity.kind !== "apiKey") return undefined;
  return { apiKeyMasked: identity.label, usersPath: bigmodelUsersPath(env) };
}

/** Prints the one-line mapping hint for a freshly signed-in unnamed BigModel key. */
export async function printBigModelKeyNameHint(
  env: NodeJS.ProcessEnv = process.env,
  output: Writable = process.stdout
): Promise<void> {
  const hint = await readBigModelKeyNameHint(env);
  if (!hint) return;
  output.write(
    `Tip: label this API key (${hint.apiKeyMasked}) by adding {"<api-key>": "<name>"} to `
    + `${hint.usersPath} — the label then replaces the masked key; `
    + "a user name, a key name or any custom label works.\n"
  );
}

/**
 * API-key snapshot of the OAuth providers, taken before a login command runs.
 * Only the two vault-backed OAuth providers are tracked; other providers never
 * have a stored identity to invalidate.
 */
export async function readProviderApiKeySnapshot(
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  try {
    const config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
    for (const providerId of oauthProviderIds) {
      const apiKey = config.provider?.[providerId]?.options?.apiKey;
      if (typeof apiKey === "string" && apiKey.trim()) snapshot[providerId] = apiKey.trim();
    }
  } catch {
    // No readable config: the empty snapshot is the correct "before" state.
  }
  return snapshot;
}

/**
 * Login flows that rewrite config.json but never refresh the vault identity
 * (BigModel OAuth and both API-key variants) can switch the account behind the
 * stored `oauth:<provider>:user_info`. A provider whose API key changed during
 * such a login no longer matches its stored name for sure, so the snapshot is
 * deleted — the TUI falls back to the masked key instead of a stale name.
 * Returns the cleared provider ids.
 */
export async function clearIdentitiesWithChangedKeys(
  before: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const current = await readProviderApiKeySnapshot(env);
  const cleared: string[] = [];
  for (const providerId of oauthProviderIds) {
    const apiKey = current[providerId];
    if (!apiKey || apiKey === before[providerId]) continue;
    try {
      const vault = await readVault(env);
      const key = `oauth:${providerId}:user_info`;
      if (!(key in vault)) continue;
      delete vault[key];
      await writeVault(vault, env);
      cleared.push(providerId);
    } catch {
      // Unreadable vault: nothing to clear for this provider.
    }
  }
  return cleared;
}

export function isIdentityInvocation(args: string[]): boolean {
  if (args[0] !== "identity") return false;
  if (args.length === 1) return true;
  if (args.length === 2 && args[1] === "clear") return true;
  return args.length === 3 && args[1] === "set" && args[2].trim().length > 0;
}

export function isLogoutInvocation(args: string[]): boolean {
  return args.length === 1 && args[0] === "logout";
}

/**
 * Vault keys a full logout removes. The runtime's own `clearZaiLoginCredentials`
 * deletes only the four `zai` keys (its BigModel OAuth flow writes
 * `oauth:bigmodel:*` entries it never cleans up), so the CLI clears both
 * providers plus the shared markers itself.
 */
const logoutVaultKeys = [
  "oauth:zai:access_token",
  "oauth:zai:refresh_token",
  "oauth:zai:user_info",
  "oauth:bigmodel:access_token",
  "oauth:bigmodel:refresh_token",
  "oauth:bigmodel:user_info",
  "oauth:login_attribution",
  "oauth:active_provider",
  "zcodejwttoken"
];

export interface LogoutResult {
  credentialsPath: string;
  /** Vault keys and official-slot config keys that were present and got deleted. */
  cleared: string[];
}

/**
 * Removes every stored sign-in credential: the shared vault entries and the
 * official `zai`/`bigmodel` slot keys in config.json (what the `/login`
 * API-key variants paste — a key sign-in is a login, so logout clears it).
 * Custom-provider slots (`env-*`) are untouched: that file serves the
 * signed-out state and keeps working after the logout. Idempotent: a missing
 * vault or already-deleted keys still report success.
 */
export async function clearOAuthLoginCredentials(
  env: NodeJS.ProcessEnv = process.env
): Promise<LogoutResult> {
  const credentialsPath = credentialsFilePath(env);
  const cleared: string[] = [];
  try {
    const vault = await readVault(env);
    for (const key of logoutVaultKeys) {
      if (key in vault) {
        delete vault[key];
        cleared.push(key);
      }
    }
    if (cleared.length > 0) await writeVault(vault, env);
  } catch {
    // No vault or unreadable file: nothing was signed in via OAuth.
  }
  try {
    await updateUserConfig((config) => {
      const provider = config.provider as Record<string, { options?: { apiKey?: unknown } }> | undefined;
      for (const providerId of oauthProviderIds) {
        const apiKey = provider?.[providerId]?.options?.apiKey;
        if (typeof apiKey !== "string" || apiKey.length === 0) continue;
        delete provider![providerId]!.options!.apiKey;
        cleared.push(`config:${providerId}:apiKey`);
      }
    }, env);
  } catch {
    // No readable config: no official-slot key to clear.
  }
  return { credentialsPath, cleared };
}

/**
 * `zcode logout` — clears the stored Z.AI and BigModel sign-in credentials.
 * Intercepts the runtime invocation because the runtime's logout only removes
 * the `zai` entries, leaving BigModel OAuth tokens and the account-name
 * snapshot (which the TUI identity display reads) behind.
 */
export async function runLogoutCommand(options: {
  env?: NodeJS.ProcessEnv;
  output?: Writable;
} = {}): Promise<number> {
  const output = options.output ?? process.stdout;
  const result = await clearOAuthLoginCredentials(options.env);
  if (result.cleared.length === 0) {
    output.write(`Already logged out. Credentials: ${result.credentialsPath}\n`);
    return 0;
  }
  output.write(`Logged out from Z.AI and BigModel. Credentials: ${result.credentialsPath}\n`);
  return 0;
}

/**
 * `zcode identity` — shows the sign-in identity behind the active provider.
 * `zcode identity set <name>` — rewrites the local `oauth:<provider>:user_info`
 * snapshot. The snapshot is written by ZCode Desktop at OAuth login and nothing
 * in the CLI refreshes it, so renaming the account on bigmodel.cn leaves the
 * TUI showing the old name; this command is the manual sync point.
 */
export async function runIdentityCommand(options: {
  args: string[];
  env?: NodeJS.ProcessEnv;
  output?: Writable;
}): Promise<number> {
  const env = options.env ?? process.env;
  const output = options.output ?? process.stdout;
  const write = (line: string) => output.write(line + "\n");

  if (options.args[1] === "set") return await setIdentityName(options.args[2]!.trim(), env, write);
  if (options.args[1] === "clear") return await clearIdentityName(env, write);

  const identity = await readLoginIdentitySnapshot(env).catch(() => undefined);
  if (!identity) {
    write("No model access configured.");
    write("Log in via `zcode login`, or set up a custom provider in ~/.zcode/cli/custom-provider.env.");
    return 0;
  }
  write(`Provider: ${identity.providerId}`);
  if (identity.kind === "signedOut") {
    write("Identity: not signed in (model access via custom provider)");
    write("Log in via `zcode login` to switch the identity display to the account.");
  } else if (identity.kind === "oauth") {
    write(`Identity: signed in as ${identity.label}`);
  } else if (identity.kind === "named") {
    write(`Identity: API key ${identity.label} (${identity.keyMasked})`);
  } else {
    write(`Identity: API key ${identity.label}`);
  }
  if (identity.providerId === "bigmodel" && identity.kind === "apiKey") {
    write(
      `Tip: label this API key by adding {"<api-key>": "<name>"} to ${bigmodelUsersPath(env)} `
      + "— the label then replaces the masked key; a user name, a key name or any custom label works."
    );
  }
  return 0;
}

async function setIdentityName(name: string, env: NodeJS.ProcessEnv, write: (line: string) => void): Promise<number> {
  if (name.length > maxNameLength) {
    write(`Error: the display name must be at most ${maxNameLength} characters.`);
    return 1;
  }
  if (!(await readStoredOAuthLogin(env))) {
    if (!(await readSignedInProvider(env))) {
      write("Error: not signed in; run `zcode login` first — the display name follows the signed-in account.");
      return 1;
    }
    write(
      "Error: signed in with an API key, not an OAuth account — `identity set` renames OAuth accounts; "
      + `for a BigModel key, label it in ${bigmodelUsersPath(env)}.`
    );
    return 1;
  }
  const providerId = await activeProviderId(env);
  if (!oauthProviderIds.has(providerId)) {
    write(`Error: provider "${providerId}" has no OAuth sign-in identity to update.`);
    return 1;
  }
  const key = `oauth:${providerId}:user_info`;
  const vault = await readVault(env);
  let userInfo: StoredUserInfo = {};
  const stored = vault[key];
  if (typeof stored === "string" && stored) {
    userInfo = JSON.parse(decryptCredential(stored, env)) as StoredUserInfo;
  }
  userInfo.username = name;
  userInfo.displayName = name;
  vault[key] = encryptCredential(JSON.stringify(userInfo), env);
  await writeVault(vault, env);
  write(`Sign-in display name for provider "${providerId}" updated to "${name}".`);
  write("The TUI banner and status line pick it up in new sessions.");
  return 0;
}

async function clearIdentityName(env: NodeJS.ProcessEnv, write: (line: string) => void): Promise<number> {
  const providerId = await activeProviderId(env);
  const key = `oauth:${providerId}:user_info`;
  const vault = await readVault(env);
  if (!(key in vault)) {
    write(`No stored sign-in identity for provider "${providerId}"; nothing to clear.`);
    return 0;
  }
  delete vault[key];
  await writeVault(vault, env);
  write(`Stored sign-in identity for provider "${providerId}" removed.`);
  write("The TUI falls back to the masked API key (when one is configured).");
  return 0;
}
