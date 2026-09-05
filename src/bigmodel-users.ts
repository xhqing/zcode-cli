import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * User-maintained API-key → display-name mapping for the BigModel login
 * channel. The file is a flat JSON object in `~/.zcode/cli/bigmodel-users.json`
 * (deliberately not the model-access `.env` — it belongs to the login flow):
 *
 *   {
 *     "<api-key>": "<display name>"
 *   }
 *
 * Login flows for bigmodel.cn rewrite the provider's API key but never learn
 * the account name, so the identity display falls back to the masked key.
 * A key present in this file is shown as its mapped name instead. The mapped
 * value is free-form — a user name, a key remark, an account name or any
 * label the user likes — it is purely local display text. It stays correct
 * across account switches because every key carries its own label.
 */

export function bigmodelUsersPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackHome: string = homedir()
): string {
  const path = platform === "win32" ? win32 : posix;
  const configuredHome = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim();
  return path.join(configuredHome || fallbackHome, ".zcode", "cli", "bigmodel-users.json");
}

/**
 * Reads the mapping file. A missing, unreadable or malformed file yields an
 * empty map; non-string or blank entries are skipped so a hand-editing
 * mistake never breaks the identity display.
 */
export async function readBigmodelUserNames(
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(bigmodelUsersPath(env), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(parsed)) {
    if (typeof name !== "string") continue;
    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (trimmedKey && trimmedName) names[trimmedKey] = trimmedName;
  }
  return names;
}

/** The mapped display name for a BigModel API key, when one is configured. */
export async function resolveBigmodelUserName(
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const names = await readBigmodelUserNames(env);
  return names[apiKey.trim()]?.trim() || undefined;
}
