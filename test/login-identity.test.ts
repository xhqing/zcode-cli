import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { bigmodelUsersPath } from "../src/bigmodel-users.ts";
import {
  loginIdentityText,
  readLoginIdentity,
  shouldPromptForLoginUserName
} from "../packages/zcode-tui/src/login-identity.ts";

const credentialSecret = "test-credential-secret";

function encryptCredential(value: string): string {
  // Mirrors decryptCredential in src/usage.ts (AES-256-GCM, enc:v1).
  const secret = credentialSecret
    || `zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`;
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const base64 = (buffer: Buffer): string => buffer.toString("base64url");
  return `enc:v1:${base64(iv)}.${base64(cipher.getAuthTag())}.${base64(data)}`;
}

interface Fixture {
  config: unknown;
  credentials?: Record<string, string>;
}

async function writeFixture(directory: string, fixture: Fixture): Promise<void> {
  await mkdir(join(directory, ".zcode", "cli"), { recursive: true });
  await mkdir(join(directory, ".zcode", "v2"), { recursive: true });
  await writeFile(join(directory, ".zcode", "cli", "config.json"), JSON.stringify(fixture.config));
  if (fixture.credentials) {
    await writeFile(
      join(directory, ".zcode", "v2", "credentials.json"),
      JSON.stringify(fixture.credentials)
    );
  }
}

function envFor(directory: string): NodeJS.ProcessEnv {
  return {
    HOME: directory,
    ZCODE_CREDENTIAL_SECRET: credentialSecret
  };
}

async function withFixture(
  fixture: Fixture,
  run: (env: NodeJS.ProcessEnv) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp();
  await writeFixture(directory, fixture);
  await run(envFor(directory));
}

async function mkdtemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return mkdtemp(join(tmpdir(), "zcode-login-identity-"));
}

const oauthConfig = (providerId: string, withApiKey = false): unknown => ({
  model: { main: `${providerId}/glm-5.3` },
  provider: {
    [providerId]: {
      options: withApiKey ? { apiKey: "916cbd2f-example-key-value-e2f1" } : {}
    }
  }
});

/** Vault entries of a stored OAuth login for the provider. */
const login = (providerId: string, extra: Record<string, string> = {}): Record<string, string> => ({
  [`oauth:${providerId}:access_token`]: "enc:v1:token",
  ...extra
});

const storedUser = (user: unknown): Record<string, string> => ({
  "oauth:bigmodel:user_info": encryptCredential(JSON.stringify(user))
});

describe("readLoginIdentity", () => {
  test("resolves the OAuth account name without an explicit API key", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: login("bigmodel", storedUser({ username: "pkcmbgx3", displayName: "Alice" }))
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "Alice" });
      }
    );
  });

  test("falls back to the username when the display name is missing", async () => {
    await withFixture(
      {
        config: oauthConfig("zai"),
        credentials: login("zai", {
          "oauth:zai:user_info": encryptCredential(JSON.stringify({ username: "pkcmbgx3" }))
        })
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "pkcmbgx3" });
      }
    );
  });

  test("prefers the OAuth account over the exchanged API key in the config", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel", storedUser({ displayName: "Alice" }))
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "Alice" });
      }
    );
  });

  test("shows the API key when the stored user info cannot be decrypted", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel", { "oauth:bigmodel:user_info": "enc:v1:garbage.value.here" })
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });

  test("a zai login identifies itself even while model.main points at bigmodel", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: login("zai", {
          "oauth:zai:user_info": encryptCredential(JSON.stringify({ displayName: "Alice" }))
        })
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "Alice" });
      }
    );
  });

  test("returns undefined for custom providers without an API key", async () => {
    await withFixture(
      { config: oauthConfig("custom") },
      async (env) => {
        expect(await readLoginIdentity(env)).toBeUndefined();
      }
    );
  });

  test("custom-provider access without a login shows the signed-out state", async () => {
    await withFixture(
      { config: oauthConfig("custom", true) },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "signedOut", label: "" });
      }
    );
  });

  test("custom-provider env-slot access strips the env- prefix for display", async () => {
    await withFixture(
      {
        config: {
          model: { main: "env-bigmodel/glm-5.3" },
          provider: { "env-bigmodel": { options: { apiKey: "916cbd2f-example-key-value-e2f1" } } }
        }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "signedOut", label: "" });
      }
    );
  });

  test("returns undefined without a configured main model", async () => {
    await withFixture(
      { config: {} },
      async (env) => {
        expect(await readLoginIdentity(env)).toBeUndefined();
      }
    );
  });

  test("returns undefined when the config file is missing", async () => {
    const directory = await mkdtemp();
    await expect(readLoginIdentity(envFor(directory))).resolves.toBeUndefined();
  });

  test("returns undefined when the stored user info cannot be decrypted", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: { "oauth:bigmodel:user_info": "enc:v1:garbage.value.here" }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toBeUndefined();
      }
    );
  });

  test("caps long display names", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: login("bigmodel", storedUser({ displayName: "a".repeat(80) }))
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "a".repeat(24) });
      }
    );
  });
});

describe("readLoginIdentity key sign-in", () => {
  test("an official-slot API key without a vault token shows the masked key", async () => {
    await withFixture(
      {
        config: {
          model: { main: "bigmodel/glm-5.3" },
          provider: { bigmodel: { options: { apiKey: "916cbd2f-example-key-value-e2f1" } } }
        }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });

  test("an official-slot key with a mapping shows the mapped name", async () => {
    await withFixture(
      {
        config: {
          model: { main: "bigmodel/glm-5.3" },
          provider: { bigmodel: { options: { apiKey: "916cbd2f-example-key-value-e2f1" } } }
        }
      },
      async (env) => {
        await writeFile(
          bigmodelUsersPath(env),
          JSON.stringify({ "916cbd2f-example-key-value-e2f1": "Work account" })
        );
        expect(await readLoginIdentity(env)).toEqual({ kind: "named", label: "Work account", keyMasked: "916c…e2f1" });
      }
    );
  });

  test("the key sign-in wins while model.main points at the custom-provider slot", async () => {
    await withFixture(
      {
        config: {
          model: { main: "env-bigmodel/glm-5.3" },
          provider: {
            bigmodel: { options: { apiKey: "916cbd2f-example-key-value-e2f1" } },
            "env-bigmodel": { options: { apiKey: "916cbd2f-example-key-value-e2f1" } }
          }
        }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });
});

describe("readLoginIdentity key-name mapping", () => {
  test("shows the mapped account name for a bigmodel API key", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel")
      },
      async (env) => {
        await writeFile(
          bigmodelUsersPath(env),
          JSON.stringify({ "916cbd2f-example-key-value-e2f1": "Work account" })
        );
        expect(await readLoginIdentity(env)).toEqual({ kind: "named", label: "Work account", keyMasked: "916c…e2f1" });
      }
    );
  });

  test("keeps the masked key when the mapping file does not cover the key", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel")
      },
      async (env) => {
        await writeFile(bigmodelUsersPath(env), JSON.stringify({ "another-key": "Other account" }));
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });

  test("keeps the masked key for a malformed mapping file", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel")
      },
      async (env) => {
        await writeFile(bigmodelUsersPath(env), "{not json");
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });

  test("ignores the mapping while signed out on a custom provider", async () => {
    await withFixture(
      { config: oauthConfig("custom", true) },
      async (env) => {
        await writeFile(
          bigmodelUsersPath(env),
          JSON.stringify({ "916cbd2f-example-key-value-e2f1": "Work account" })
        );
        expect(await readLoginIdentity(env)).toEqual({ kind: "signedOut", label: "" });
      }
    );
  });

  test("the stored OAuth user_info still wins over the mapping", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel", true),
        credentials: login("bigmodel", storedUser({ displayName: "Alice" }))
      },
      async (env) => {
        await writeFile(
          bigmodelUsersPath(env),
          JSON.stringify({ "916cbd2f-example-key-value-e2f1": "Work account" })
        );
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "Alice" });
      }
    );
  });
});

describe("loginIdentityText", () => {
  test("labels OAuth accounts, API keys and the signed-out state differently", () => {
    expect(loginIdentityText({ kind: "oauth", label: "Alice" })).toBe("Signed in as Alice");
    expect(loginIdentityText({ kind: "apiKey", label: "916c…e2f1" })).toBe("API key 916c…e2f1");
    expect(loginIdentityText({ kind: "named", label: "Work account", keyMasked: "916c…e2f1" }))
      .toBe("API key Work account (916c…e2f1)");
    expect(loginIdentityText({ kind: "signedOut", label: "" })).toBe("Not signed in");
  });
});

describe("shouldPromptForLoginUserName", () => {
  test("matches both BigModel login variants, with or without a pasted key", () => {
    expect(shouldPromptForLoginUserName("/login bigmodel-coding-plan")).toBe(true);
    expect(shouldPromptForLoginUserName("/login bigmodel-coding-plan-api-key")).toBe(true);
    expect(shouldPromptForLoginUserName("/login bigmodel-coding-plan-api-key 916cbd2f-example")).toBe(true);
  });

  test("leaves plain /login, Z.AI logins and unrelated commands alone", () => {
    expect(shouldPromptForLoginUserName("/login")).toBe(false);
    expect(shouldPromptForLoginUserName("/login zai-coding-plan")).toBe(false);
    expect(shouldPromptForLoginUserName("/login zai-coding-plan-api-key")).toBe(false);
    expect(shouldPromptForLoginUserName("/logout")).toBe(false);
    expect(shouldPromptForLoginUserName("/login bigmodel-coding-plans")).toBe(false);
  });
});
