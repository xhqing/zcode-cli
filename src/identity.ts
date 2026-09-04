import { readFile, writeFile } from "node:fs/promises";
import type { Writable } from "node:stream";

import { userConfigPath } from "./model-access.ts";
import { credentialsFilePath, decryptCredential, encryptCredential, maskApiKey } from "./usage.ts";

/** OAuth providers whose account name lives in the credential vault. */
const oauthProviderIds = new Set(["zai", "bigmodel"]);

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

export interface LoginIdentitySnapshot {
  providerId: string;
  kind: "oauth" | "apiKey";
  label: string;
}

/**
 * Resolves the sign-in identity the TUI banner/status line shows. Mirrors the
 * lookup order of `packages/zcode-tui/src/login-identity.ts` (duplicated here
 * because the TUI package depends on `src/`, not the other way around).
 */
export async function readLoginIdentitySnapshot(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoginIdentitySnapshot | undefined> {
  const providerId = await activeProviderId(env);
  const config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
  const provider = config.provider?.[providerId];
  if (!provider) return undefined;

  if (oauthProviderIds.has(providerId)) {
    try {
      const vault = await readVault(env);
      const stored = vault[`oauth:${providerId}:user_info`];
      if (typeof stored === "string" && stored) {
        const userInfo = JSON.parse(decryptCredential(stored, env)) as StoredUserInfo;
        const label = identityLabel(userInfo.displayName) ?? identityLabel(userInfo.username);
        if (label) return { providerId, kind: "oauth", label };
      }
    } catch {
      // Missing vault entry or unreadable credential: fall through to the key.
    }
  }

  const apiKey = typeof provider.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
  if (apiKey) return { providerId, kind: "apiKey", label: maskApiKey(apiKey) };
  return undefined;
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
    write("No sign-in identity found for the active provider.");
    write("Log in via `zcode login`, then check again with `zcode identity`.");
    return 0;
  }
  write(`Provider: ${identity.providerId}`);
  write(`Identity: ${identity.kind === "oauth" ? `signed in as ${identity.label}` : `API key ${identity.label}`}`);
  return 0;
}

async function setIdentityName(name: string, env: NodeJS.ProcessEnv, write: (line: string) => void): Promise<number> {
  if (name.length > maxNameLength) {
    write(`Error: the display name must be at most ${maxNameLength} characters.`);
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
