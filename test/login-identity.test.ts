import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  loginIdentityText,
  readLoginIdentity
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

const storedUser = (user: unknown): Record<string, string> => ({
  "oauth:bigmodel:user_info": encryptCredential(JSON.stringify(user))
});

describe("readLoginIdentity", () => {
  test("resolves the OAuth account name without an explicit API key", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: storedUser({ username: "pkcmbgx3", displayName: "Alice" })
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
        credentials: {
          "oauth:zai:user_info": encryptCredential(JSON.stringify({ username: "pkcmbgx3" }))
        }
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
        credentials: storedUser({ displayName: "Alice" })
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
        credentials: { "oauth:bigmodel:user_info": "enc:v1:garbage.value.here" }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
      }
    );
  });

  test("returns undefined when only the zai vault entry exists for bigmodel access", async () => {
    await withFixture(
      {
        config: oauthConfig("bigmodel"),
        credentials: {
          "oauth:zai:user_info": encryptCredential(JSON.stringify({ displayName: "Alice" }))
        }
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toBeUndefined();
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

  test("shows the masked API key for custom providers", async () => {
    await withFixture(
      { config: oauthConfig("custom", true) },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "apiKey", label: "916c…e2f1" });
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
        credentials: storedUser({ displayName: "a".repeat(80) })
      },
      async (env) => {
        expect(await readLoginIdentity(env)).toEqual({ kind: "oauth", label: "a".repeat(24) });
      }
    );
  });
});

describe("loginIdentityText", () => {
  test("labels OAuth accounts and API keys differently", () => {
    expect(loginIdentityText({ kind: "oauth", label: "Alice" })).toBe("Signed in as Alice");
    expect(loginIdentityText({ kind: "apiKey", label: "916c…e2f1" })).toBe("API key 916c…e2f1");
  });
});
