import { access, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

import { updateUserConfig, userConfigPath, type UserConfigRecord } from "./model-access.ts";
import { collectApiKeys, numberedApiKeyPattern, placeholderApiKey } from "./key-failover.ts";

/**
 * Custom-provider file configuration.
 *
 * Users who prefer editing one flat file over hand-editing the nested
 * config.json keep their model settings in `~/.zcode/cli/custom-provider.env`
 * (copy the template from `custom-provider.env.example`). The file is the
 * authority for the signed-out state: while no OAuth login is stored, the
 * launcher syncs it into config.json on every start — the `env-<provider-id>`
 * provider entry and the `model` block — and every other config.json block
 * stays untouched, including the official `zai`/`bigmodel` slots owned by
 * `/login` OAuth flows. Once a login is stored, the sync stops rewriting the
 * `model` block (the login's official slot takes over) and reclaims it again
 * automatically after a logout, so logins and the custom provider never
 * require manually removing or restoring the file.
 */

export const envFileVariables = [
  "ZCODE_PROVIDER_ID",
  "ZCODE_PROVIDER_NAME",
  "ZCODE_PROVIDER_KIND",
  "ZCODE_BASE_URL",
  "ZCODE_API_KEY",
  "ZCODE_MAIN_MODEL",
  "ZCODE_LITE_MODEL",
  "ZCODE_EXTRA_MODELS"
] as const;

export type EnvFileVariable = (typeof envFileVariables)[number];

/**
 * Env-file values including the numbered backup key variables
 * (`ZCODE_API_KEY_2`, ...) that `envFileVariables` does not enumerate.
 */
export type EnvFileValues = Partial<Record<EnvFileVariable, string>> & {
  [variable: string]: string | undefined;
};

export interface EnvFileContent {
  path: string;
  values: EnvFileValues;
}

export interface EnvFileSyncResult {
  applied: boolean;
  configPath: string;
  envPath: string;
  /** Present when the file declares model settings that failed validation. */
  error?: string;
  /** Present when the file declared several API keys and failover activated. */
  failover?: FailoverBuild;
}

export const customProviderEnvFileName = "custom-provider.env";

export function envFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackHome: string = homedir()
): string {
  const configured = env.ZCODE_ENV_FILE?.trim();
  if (configured) return configured;
  const path = platform === "win32" ? win32 : posix;
  const configuredHome = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim();
  return path.join(configuredHome || fallbackHome, ".zcode", "cli", customProviderEnvFileName);
}

/**
 * One-time rename of the legacy `~/.zcode/cli/.env` to
 * `custom-provider.env`. Returns the new path when a rename happened, so the
 * caller can tell the user. Skipped entirely when `ZCODE_ENV_FILE` overrides
 * the location or the new name already exists.
 */
export async function migrateLegacyEnvFile(
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  if (env.ZCODE_ENV_FILE?.trim()) return undefined;
  const nextPath = envFilePath(env);
  const legacyPath = join(dirname(nextPath), ".env");
  try {
    await access(nextPath);
    return undefined;
  } catch {
    // New file absent: a legacy file is worth renaming.
  }
  try {
    await access(legacyPath);
  } catch {
    return undefined;
  }
  await rename(legacyPath, nextPath);
  return nextPath;
}

/**
 * Parses dotenv-style text: `KEY=value` lines, `#` comments, blank lines.
 * Surrounding quotes are stripped, everything else stays verbatim. Lines that
 * do not match the known variable set (base variables plus the numbered
 * `ZCODE_API_KEY_<n>` backup keys) are ignored so the file can carry
 * unrelated entries without breaking startup.
 */
export function parseEnvFileContent(text: string): EnvFileValues {
  const values: EnvFileValues = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const knownKey = (envFileVariables as readonly string[]).includes(key) || numberedApiKeyPattern.test(key);
    if (!knownKey) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (value) values[key] = value;
  }
  return values;
}

export async function readEnvFile(
  env: NodeJS.ProcessEnv = process.env
): Promise<EnvFileContent | null> {
  const path = envFilePath(env);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return { path, values: parseEnvFileContent(text) };
}

/** `glm-5.2,glm-5-turbo:Turbo` -> `[{id, name}, ...]`, first occurrence wins. */
function parseModels(modelsText: string): Map<string, { name: string }> {
  const models = new Map<string, { name: string }>();
  for (const rawItem of modelsText.split(",")) {
    const item = rawItem.trim();
    if (!item) continue;
    // Entries may be bare IDs (`glm-5.2`) or `id:Display Name` pairs.
    const colon = item.indexOf(":");
    const id = (colon < 0 ? item : item.slice(0, colon)).trim();
    const name = colon < 0 ? id : item.slice(colon + 1).trim() || id;
    if (id && !models.has(id)) models.set(id, { name });
  }
  return models;
}

function displayName(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const providerBaseUrlDefaults: Record<string, string> = {
  zai: "https://api.z.ai/api/anthropic",
  bigmodel: "https://open.bigmodel.cn/api/anthropic"
};

/**
 * Real upstream API root for the declared provider (before any failover
 * rewrite). `undefined` mirrors the `ZCODE_BASE_URL is not set` build error.
 */
export function resolveUpstreamBaseURL(
  values: Partial<Record<EnvFileVariable, string>>
): string | undefined {
  const providerId = (values.ZCODE_PROVIDER_ID?.trim() || "zai").toLowerCase();
  return values.ZCODE_BASE_URL?.trim() || providerBaseUrlDefaults[providerId];
}

/** Failover activation reported by `buildProviderConfig` / env sync. */
export interface FailoverBuild {
  /** Loopback proxy baseURL that replaced the provider's real endpoint. */
  proxyBaseURL: string;
  keyCount: number;
}

export interface ProviderBuild {
  providerId: string;
  /** The provider entry to store under `config.provider[providerId]`. */
  provider: UserConfigRecord;
  model: { main: string; lite: string };
  failover?: FailoverBuild;
}

/**
 * Prefix for the config.json provider slot the custom-provider file writes.
 * The file never touches the official `zai`/`bigmodel` slots (those belong to
 * `/login` OAuth flows), so custom-provider keys and OAuth logins cannot
 * overwrite each other.
 */
export const envProviderSlotPrefix = "env-";

/**
 * User-facing provider id: the internal `env-` slot prefix is configuration
 * plumbing, not something the user declared or should ever see.
 */
export function displayProviderId(providerId: string): string {
  return providerId.startsWith(envProviderSlotPrefix)
    ? providerId.slice(envProviderSlotPrefix.length)
    : providerId;
}

/** User-facing `<provider-id>/<model-id>` reference with the slot prefix stripped. */
export function displayModelRef(model: string): string {
  const separator = model.indexOf("/");
  if (separator <= 0) return model;
  return `${displayProviderId(model.slice(0, separator))}/${model.slice(separator + 1)}`;
}

/**
 * Moves a `model` block that still points at a custom-provider slot
 * (`env-<id>/...`) over to the signed-in provider's official slot, so a login
 * takes over the model selection at the next start. Model ids are kept when
 * the official slot declares them; otherwise the slot's first declared model
 * is used. Anything not pointing at an `env-` slot is left untouched, as is a
 * missing official slot. Returns whether the block was rewritten.
 */
export async function switchModelBlockToOfficialProvider(
  officialProviderId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  let switched = false;
  await updateUserConfig((config) => {
    const model = config.model as { main?: unknown; lite?: unknown } | undefined;
    const main = typeof model?.main === "string" ? model.main.trim() : "";
    if (!main.startsWith(envProviderSlotPrefix)) return;
    const official = (config.provider as Record<string, { models?: Record<string, unknown> }> | undefined)
      ?.[officialProviderId];
    const officialModels = official?.models;
    if (!officialModels || typeof officialModels !== "object") return;

    const mainId = main.slice(main.indexOf("/") + 1);
    const mainIdKnown = Object.prototype.hasOwnProperty.call(officialModels, mainId);
    const firstDeclaredId = Object.keys(officialModels)[0];
    const nextMainId = mainIdKnown ? mainId : firstDeclaredId;
    if (!nextMainId) return;

    const lite = typeof model?.lite === "string" ? model.lite.trim() : "";
    const liteId = lite.startsWith(envProviderSlotPrefix) ? lite.slice(lite.indexOf("/") + 1) : "";
    const liteIdKnown = liteId !== ""
      && Object.prototype.hasOwnProperty.call(officialModels, liteId);
    const nextLiteId = liteIdKnown ? liteId : nextMainId;

    config.model = {
      main: `${officialProviderId}/${nextMainId}`,
      lite: `${officialProviderId}/${nextLiteId}`
    };
    switched = true;
  }, env);
  return switched;
}

/**
 * Validates env-file values and builds the provider/model config blocks. The
 * declared `ZCODE_PROVIDER_ID` (default `zai`) names the upstream flavor for
 * base-URL defaults and display names; the config slot is always
 * `env-<provider-id>` so env-file configuration lives in its own provider
 * entry — the upstream runtime login gate only inspects the official
 * `zai`/`bigmodel` slots, which the launcher-side access check compensates for.
 *
 * Keys are one per variable: `ZCODE_API_KEY` holds the primary key and
 * numbered `ZCODE_API_KEY_2`, `ZCODE_API_KEY_3`, ... hold backups. With a
 * `failover` proxy baseURL supplied (the launcher always supplies one) a
 * multi-key file writes the proxy address plus a placeholder key into
 * config.json — the real keys live only in the in-memory proxy. Without a
 * proxy a multi-key setup degrades to its first key.
 */
export function buildProviderConfig(
  values: EnvFileValues,
  failover?: { proxyBaseURL: string }
): ProviderBuild | { error: string } {
  const apiKeys = collectApiKeys(values);
  const apiKey = apiKeys[0];
  if (!apiKey) return { error: "ZCODE_API_KEY is not set" };
  const providerId = (values.ZCODE_PROVIDER_ID?.trim() || "zai").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(providerId)) {
    return { error: `invalid ZCODE_PROVIDER_ID "${providerId}" (lowercase letters, digits and dashes only)` };
  }

  const kind = values.ZCODE_PROVIDER_KIND?.trim() || "anthropic";
  if (!["anthropic", "openai", "openai-compatible"].includes(kind)) {
    return { error: `invalid ZCODE_PROVIDER_KIND "${kind}" (anthropic, openai or openai-compatible)` };
  }

  const mainModel = values.ZCODE_MAIN_MODEL?.trim();
  if (!mainModel) return { error: "ZCODE_MAIN_MODEL is not set" };
  const liteModel = values.ZCODE_LITE_MODEL?.trim() || mainModel;

  const baseURL = resolveUpstreamBaseURL(values);
  if (!baseURL) return { error: "ZCODE_BASE_URL is not set" };
  const failoverActive = apiKeys.length > 1 && failover !== undefined;

  // Declaring the selected models keeps the generated config internally
  // consistent even when they are absent from ZCODE_EXTRA_MODELS.
  const models = parseModels(values.ZCODE_EXTRA_MODELS ?? "");
  if (!models.has(mainModel)) models.set(mainModel, { name: displayName(mainModel) });
  if (!models.has(liteModel)) models.set(liteModel, { name: displayName(liteModel) });

  return {
    providerId: envProviderSlotPrefix + providerId,
    provider: {
      kind,
      name: values.ZCODE_PROVIDER_NAME?.trim() || displayName(providerId),
      options: {
        apiKey: failoverActive ? placeholderApiKey : apiKey,
        apiKeyRequired: true,
        baseURL: failoverActive ? failover!.proxyBaseURL : baseURL
      },
      models: Object.fromEntries(models)
    },
    model: {
      main: `${envProviderSlotPrefix}${providerId}/${mainModel}`,
      lite: `${envProviderSlotPrefix}${providerId}/${liteModel}`
    },
    ...(failoverActive ? {
      failover: { proxyBaseURL: failover!.proxyBaseURL, keyCount: apiKeys.length }
    } : {})
  };
}

export interface EnvFileSyncOptions {
  /**
   * Loopback failover-proxy baseURL. When the file declares several API
   * keys, the provider entry is rewritten to point here with a placeholder
   * key; the proxy itself holds the real keys in memory.
   */
  failoverProxyBaseURL?: string;
  /**
   * Signed-in state: refresh the custom-provider slot's data but leave the
   * `model` block alone — the login's official slot owns the model selection
   * while signed in, and the block reverts to the custom-provider slot
   * automatically after a logout.
   */
  skipModelBlock?: boolean;
}

/**
 * Reads `~/.zcode/cli/custom-provider.env` and, when it declares model
 * settings, syncs them into config.json. While signed out the file is the
 * authority for its own provider entry and the `model` block; other
 * providers (for example credentials written by an OAuth login) and every
 * unrelated config block are left untouched. While signed in
 * (`skipModelBlock`) only the provider entry is refreshed. Returns `error`
 * when declared settings fail validation — the caller should stop with that
 * message instead of silently falling back to a stale config.
 */
export async function syncEnvFileToConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: EnvFileSyncOptions = {}
): Promise<EnvFileSyncResult> {
  const configPath = userConfigPath(env);
  const file = await readEnvFile(env);
  if (!file) return { applied: false, configPath, envPath: envFilePath(env) };
  if (collectApiKeys(file.values).length === 0 && !file.values.ZCODE_MAIN_MODEL) {
    return { applied: false, configPath, envPath: file.path };
  }

  const built = buildProviderConfig(
    file.values,
    options.failoverProxyBaseURL ? { proxyBaseURL: options.failoverProxyBaseURL } : undefined
  );
  if ("error" in built) {
    return { applied: false, configPath, envPath: file.path, error: built.error };
  }

  await updateUserConfig((config) => {
    const provider = config.provider as Record<string, unknown> | undefined;
    config.provider = { ...provider, [built.providerId]: built.provider };
    if (!options.skipModelBlock) config.model = { ...built.model };
  }, env);
  return {
    applied: true,
    configPath,
    envPath: file.path,
    ...(built.failover ? { failover: built.failover } : {})
  };
}
