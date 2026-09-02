import { readFile } from "node:fs/promises";

import { userConfigPath } from "../../../src/model-access.ts";
import { credentialsFilePath, decryptCredential, maskApiKey } from "../../../src/usage.ts";

/** How the active provider authenticates, as shown in the banner and status line. */
export interface LoginIdentity {
  kind: "oauth" | "apiKey";
  /** OAuth account name, or the masked API key. */
  label: string;
}

/** OAuth providers whose account name is stored in the credential vault. */
const oauthProviderIds = new Set(["zai", "bigmodel"]);

const maxLabelWidth = 24;

interface UserConfigShape {
  model?: { main?: unknown };
  provider?: Record<string, { options?: { apiKey?: unknown } } | undefined>;
}

interface StoredUserInfo {
  username?: unknown;
  displayName?: unknown;
}

function identityLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim().slice(0, maxLabelWidth);
  return label || undefined;
}

/**
 * Resolves the signed-in identity behind the active provider: the OAuth account
 * name from the encrypted `oauth:<provider>:user_info` credential wins, and the
 * masked API key is only shown when no OAuth login is stored. Order matters:
 * the runtime's OAuth flow exchanges the access token for an API key and writes
 * it into `provider.options.apiKey` (reverse-engineered from the vendor bundle),
 * so an explicit key alongside a stored login is the login's own artifact — the
 * user is still signed in as that account. Returns undefined when neither is
 * available — the login wizard warning covers that state, so nothing
 * identity-like should be displayed.
 */
export async function readLoginIdentity(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoginIdentity | undefined> {
  let config: UserConfigShape;
  try {
    config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserConfigShape;
  } catch {
    return undefined;
  }
  const model = typeof config.model?.main === "string" ? config.model.main.trim() : "";
  const separator = model.indexOf("/");
  if (separator <= 0) return undefined;
  const providerId = model.slice(0, separator);
  const provider = config.provider?.[providerId];
  if (!provider) return undefined;

  if (oauthProviderIds.has(providerId)) {
    try {
      const credentials = JSON.parse(
        await readFile(credentialsFilePath(env), "utf8")
      ) as Record<string, string>;
      const stored = credentials[`oauth:${providerId}:user_info`];
      if (typeof stored === "string" && stored) {
        const userInfo = JSON.parse(decryptCredential(stored, env)) as StoredUserInfo;
        const label = identityLabel(userInfo.displayName) ?? identityLabel(userInfo.username);
        if (label) return { kind: "oauth", label };
      }
    } catch {
      // Missing vault entry or unreadable credential: fall through to the key.
    }
  }

  const apiKey = typeof provider.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
  if (apiKey) return { kind: "apiKey", label: maskApiKey(apiKey) };
  return undefined;
}

/** Banner text for the identity line, e.g. "Signed in as alice" or "API key 916c…e2f1". */
export function loginIdentityText(identity: LoginIdentity): string {
  return identity.kind === "oauth" ? `Signed in as ${identity.label}` : `API key ${identity.label}`;
}
