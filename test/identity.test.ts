import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import {
  decryptCredential,
  encryptCredential
} from "../src/usage.ts";
import {
  bigmodelUsersPath,
  readBigmodelUserNames,
  writeBigmodelUserName
} from "../src/bigmodel-users.ts";
import {
  clearIdentitiesWithChangedKeys,
  clearOAuthLoginCredentials,
  isIdentityInvocation,
  isLogoutInvocation,
  readBigModelKeyNameHint,
  readLoginIdentitySnapshot,
  readProviderApiKeySnapshot,
  readSignedInProvider,
  readStoredOAuthLogin,
  resolveModelSlotRef,
  runIdentityCommand,
  runLogoutCommand
} from "../src/identity.ts";
import { userConfigPath } from "../src/model-access.ts";

const secretEnv = { ZCODE_CREDENTIAL_SECRET: "test-secret" } as NodeJS.ProcessEnv;

class MemoryOutput extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.lines.join("");
  }
}

interface Fixture {
  home: string;
  env: NodeJS.ProcessEnv;
  output: MemoryOutput;
  cleanup: () => Promise<void>;
}

async function createFixture(vaultEntries: Record<string, string> = {}, config: unknown = {
  model: { main: "bigmodel/glm-5.3" },
  provider: { bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "zcode-identity-"));
  const env: NodeJS.ProcessEnv = { ...secretEnv, HOME: home };
  await mkdir(join(home, ".zcode", "v2"), { recursive: true });
  await mkdir(join(home, ".zcode", "cli"), { recursive: true });
  await writeFile(join(home, ".zcode", "v2", "credentials.json"), JSON.stringify(vaultEntries));
  await writeFile(userConfigPath(env), JSON.stringify(config));
  const output = new MemoryOutput();
  return { home, env, output, cleanup: async () => { await rm(home, { recursive: true, force: true }); } };
}

function encryptedUserInfo(userInfo: unknown): string {
  return encryptCredential(JSON.stringify(userInfo), secretEnv);
}

/** Vault entries of a stored BigModel OAuth login, with optional extras. */
function bigmodelLogin(extra: Record<string, string> = {}): Record<string, string> {
  return { "oauth:bigmodel:access_token": "enc:v1:bm-token", ...extra };
}

describe("credential encryption round trip", () => {
  test("encryptCredential inverts decryptCredential", () => {
    const plain = JSON.stringify({ username: "alice", displayName: "alice" });
    const sealed = encryptCredential(plain, secretEnv);
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(decryptCredential(sealed, secretEnv)).toBe(plain);
  });

  test("produces a fresh ciphertext (random IV) per call", () => {
    const a = encryptCredential("same-input", secretEnv);
    const b = encryptCredential("same-input", secretEnv);
    expect(a).not.toBe(b);
    expect(decryptCredential(a, secretEnv)).toBe("same-input");
  });
});

describe("identity invocation", () => {
  test("accepts show, set <name>, and clear only", () => {
    expect(isIdentityInvocation(["identity"])).toBe(true);
    expect(isIdentityInvocation(["identity", "set", "alice"])).toBe(true);
    expect(isIdentityInvocation(["identity", "clear"])).toBe(true);
    expect(isIdentityInvocation(["identity", "set"])).toBe(false);
    expect(isIdentityInvocation(["identity", "set", "  "])).toBe(false);
    expect(isIdentityInvocation(["identity", "bogus"])).toBe(false);
    expect(isIdentityInvocation(["stats"])).toBe(false);
    expect(isIdentityInvocation([])).toBe(false);
  });
});

describe("stored OAuth login detection", () => {
  test("the marker names the provider when its access token exists", async () => {
    const fx = await createFixture({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:access_token": "enc:v1:bm-token"
    });
    try {
      expect(await readStoredOAuthLogin(fx.env)).toBe("bigmodel");
    } finally {
      await fx.cleanup();
    }
  });

  test("a marker without its token falls through to the token scan", async () => {
    const fx = await createFixture({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:zai:access_token": "enc:v1:zai-token"
    });
    try {
      expect(await readStoredOAuthLogin(fx.env)).toBe("zai");
    } finally {
      await fx.cleanup();
    }
  });

  test("no vault or no tokens means no login", async () => {
    const noVault = await createFixture({}, { provider: {} });
    try {
      expect(await readStoredOAuthLogin(noVault.env)).toBeUndefined();
    } finally {
      await noVault.cleanup();
    }
    const infoOnly = await createFixture({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "name" })
    });
    try {
      // A user_info snapshot alone is not a login — only a token is.
      expect(await readStoredOAuthLogin(infoOnly.env)).toBeUndefined();
    } finally {
      await infoOnly.cleanup();
    }
  });
});

describe("sign-in provider detection", () => {
  test("a vault token wins over an official-slot key", async () => {
    const fx = await createFixture({
      "oauth:zai:access_token": "enc:v1:zai-token"
    }, {
      model: { main: "bigmodel/glm-5.3" },
      provider: { bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      expect(await readSignedInProvider(fx.env)).toBe("zai");
    } finally {
      await fx.cleanup();
    }
  });

  test("an official-slot key is a sign-in, model selection first", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: { bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      expect(await readSignedInProvider(fx.env)).toBe("bigmodel");
    } finally {
      await fx.cleanup();
    }
  });

  test("custom-provider slots and blank keys are not a sign-in", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: {
        "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        bigmodel: { options: { apiKey: "  " } }
      }
    });
    try {
      expect(await readSignedInProvider(fx.env)).toBeUndefined();
    } finally {
      await fx.cleanup();
    }
  });
});

describe("model slot resolution", () => {
  // The signed-out custom-provider shape: no vault login, no official-slot
  // key, and the credentialed env slot declaring the picked model.
  const signedOutConfig = {
    model: { main: "env-bigmodel/glm-5.3" },
    provider: {
      "env-bigmodel": {
        options: { apiKey: "e984bb0123456789abcdefVM9e" },
        models: { "glm-5.3": { name: "Glm 5.3" }, "glm-5-turbo": { name: "Glm 5 Turbo" } }
      }
    }
  };

  test("falls back to the credentialed env slot while signed out", async () => {
    const fx = await createFixture({}, signedOutConfig);
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3", fx.env)).toBe("env-bigmodel/glm-5.3");
      expect(await resolveModelSlotRef("bigmodel/glm-5-turbo", fx.env)).toBe("env-bigmodel/glm-5-turbo");
    } finally {
      await fx.cleanup();
    }
  });

  test("keeps the official reference when the env slot does not declare the model", async () => {
    const fx = await createFixture({}, signedOutConfig);
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3-air", fx.env)).toBe("bigmodel/glm-5.3-air");
    } finally {
      await fx.cleanup();
    }
  });

  test("keeps the official reference when no credentialed env slot exists", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: { "env-bigmodel": { options: { apiKey: "  " } } }
    });
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3", fx.env)).toBe("bigmodel/glm-5.3");
    } finally {
      await fx.cleanup();
    }
  });

  test("keeps the official reference when the official slot holds a key", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        ...signedOutConfig.provider
      }
    });
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3", fx.env)).toBe("bigmodel/glm-5.3");
    } finally {
      await fx.cleanup();
    }
  });

  test("keeps the official reference when a vault token names the provider", async () => {
    const fx = await createFixture({
      "oauth:bigmodel:access_token": "enc:v1:bm-token"
    }, signedOutConfig);
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3", fx.env)).toBe("bigmodel/glm-5.3");
    } finally {
      await fx.cleanup();
    }
  });

  test("falls back per provider when the login belongs to another provider", async () => {
    const fx = await createFixture({
      "oauth:zai:access_token": "enc:v1:zai-token"
    }, signedOutConfig);
    try {
      expect(await resolveModelSlotRef("bigmodel/glm-5.3", fx.env)).toBe("env-bigmodel/glm-5.3");
      expect(await resolveModelSlotRef("zai/glm-5.2", fx.env)).toBe("zai/glm-5.2");
    } finally {
      await fx.cleanup();
    }
  });

  test("returns env-slot references and non-reference input unchanged", async () => {
    const fx = await createFixture({}, signedOutConfig);
    try {
      expect(await resolveModelSlotRef("env-bigmodel/glm-5.3", fx.env)).toBe("env-bigmodel/glm-5.3");
      expect(await resolveModelSlotRef("main", fx.env)).toBe("main");
      expect(await resolveModelSlotRef("custom/model", fx.env)).toBe("custom/model");
    } finally {
      await fx.cleanup();
    }
  });
});

describe("login identity snapshot", () => {
  test("prefers the stored OAuth user_info over the API key", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:user_info": encryptedUserInfo({
        id: "65241782030085862",
        username: "old-name",
        displayName: "old-name",
        avatarUrl: "https://cdn.bigmodel.cn/blob"
      })
    }));
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "old-name" });
    } finally {
      await fx.cleanup();
    }
  });

  test("falls back to the masked API key without a stored user_info", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity?.kind).toBe("apiKey");
      expect(identity?.label).toBe(maskedKey());
    } finally {
      await fx.cleanup();
    }
  });

  test("resolves the provider from the token scan when the vault marker is absent", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "from-token-scan" })
    }));
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "from-token-scan" });
    } finally {
      await fx.cleanup();
    }
  });

  test("an official-slot API key is a sign-in: the masked key without a mapping", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: { bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "apiKey", label: maskedKey() });
    } finally {
      await fx.cleanup();
    }
  });

  test("an official-slot API key with a mapping shows the mapped name", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: { bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "e984bb0123456789abcdefVM9e": "工作账号" }));
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "named", label: "工作账号", keyMasked: maskedKey() });
    } finally {
      await fx.cleanup();
    }
  });

  test("the model selection's official slot wins over the zai-first scan", async () => {
    const fx = await createFixture({}, {
      model: { main: "bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        zai: { options: { apiKey: "916cee0123456789abcdefVM9e" } }
      }
    });
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity?.providerId).toBe("bigmodel");
    } finally {
      await fx.cleanup();
    }
  });

  test("a stored OAuth login still wins over an official-slot key", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "oauth-account" })
    }), {
      model: { main: "zai/glm-5.3" },
      provider: {
        zai: { options: { apiKey: "916cee0123456789abcdefVM9e" } }
      }
    });
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "oauth-account" });
    } finally {
      await fx.cleanup();
    }
  });

  test("without a login the identity is signed out, with the env- slot prefix stripped", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3", lite: "env-bigmodel/glm-5-turbo" },
      provider: { "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "signedOut", label: "" });
    } finally {
      await fx.cleanup();
    }
  });

  test("without a login and without model access there is no identity at all", async () => {
    const fx = await createFixture({}, { provider: {} });
    try {
      expect(await readLoginIdentitySnapshot(fx.env)).toBeUndefined();
    } finally {
      await fx.cleanup();
    }
  });

  test("a signed-in login wins even while model.main points at the custom-provider slot", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "live-account" })
    }), {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } }
      }
    });
    try {
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "live-account" });
    } finally {
      await fx.cleanup();
    }
  });
});

function maskedKey(): string {
  const key = "e984bb0123456789abcdefVM9e";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

describe("bigmodel key display names", () => {
  test("a mapped key resolves to kind named with the account name", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "e984bb0123456789abcdefVM9e": "工作账号" }));
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "named", label: "工作账号", keyMasked: maskedKey() });
    } finally {
      await fx.cleanup();
    }
  });

  test("the stored OAuth user_info still wins over the mapping", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "oauth-name" })
    }));
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "e984bb0123456789abcdefVM9e": "mapped-name" }));
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "oauth-name" });
    } finally {
      await fx.cleanup();
    }
  });

  test("the mapping is scoped to the bigmodel provider", async () => {
    const fx = await createFixture({ "oauth:zai:access_token": "enc:v1:zai-token" }, {
      model: { main: "zai/glm-5.3" },
      provider: { zai: { options: { apiKey: "916cee0123456789abcdefVM9e" } } }
    });
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "916cee0123456789abcdefVM9e": "zai-name" }));
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "zai", kind: "apiKey", label: "916c…VM9e" });
    } finally {
      await fx.cleanup();
    }
  });

  test("readBigmodelUserNames tolerates missing, malformed and non-object files", async () => {
    const fx = await createFixture();
    try {
      // Missing file.
      expect(await readBigmodelUserNames(fx.env)).toEqual({});
      // Malformed JSON and non-object roots.
      await writeFile(bigmodelUsersPath(fx.env), "{not json");
      expect(await readBigmodelUserNames(fx.env)).toEqual({});
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify(["a", "b"]));
      expect(await readBigmodelUserNames(fx.env)).toEqual({});
      // Non-string values and blank entries are dropped, valid ones kept.
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({
        "key-a": "Name A",
        "key-b": 123,
        "  ": "blank key",
        "key-c": "  "
      }));
      expect(await readBigmodelUserNames(fx.env)).toEqual({ "key-a": "Name A" });
    } finally {
      await fx.cleanup();
    }
  });

  test("readBigModelKeyNameHint reports an unmapped bigmodel key", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      const hint = await readBigModelKeyNameHint(fx.env);
      expect(hint).toEqual({ apiKeyMasked: maskedKey(), usersPath: bigmodelUsersPath(fx.env) });
    } finally {
      await fx.cleanup();
    }
  });

  test("readBigModelKeyNameHint stays silent for mapped keys, other providers and missing access", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "e984bb0123456789abcdefVM9e": "named" }));
      expect(await readBigModelKeyNameHint(fx.env)).toBeUndefined();
    } finally {
      await fx.cleanup();
    }

    const zai = await createFixture({ "oauth:zai:access_token": "enc:v1:zai-token" }, {
      model: { main: "zai/glm-5.3" },
      provider: { zai: { options: { apiKey: "916cee0123456789abcdefVM9e" } } }
    });
    try {
      expect(await readBigModelKeyNameHint(zai.env)).toBeUndefined();
    } finally {
      await zai.cleanup();
    }

    const none = await createFixture({}, { provider: {} });
    try {
      expect(await readBigModelKeyNameHint(none.env)).toBeUndefined();
    } finally {
      await none.cleanup();
    }
  });

  test("readBigModelKeyNameHint stays silent while signed out on a custom provider", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: { "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      expect(await readBigModelKeyNameHint(fx.env)).toBeUndefined();
    } finally {
      await fx.cleanup();
    }
  });

  test("writeBigmodelUserName upserts one label and preserves the rest", async () => {
    const fx = await createFixture();
    try {
      await writeFile(
        bigmodelUsersPath(fx.env),
        JSON.stringify({ "another-key": "Other account" })
      );
      await writeBigmodelUserName("e984bb0123456789abcdefVM9e", "工作账号", fx.env);
      expect(await readBigmodelUserNames(fx.env)).toEqual({
        "another-key": "Other account",
        "e984bb0123456789abcdefVM9e": "工作账号"
      });
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "named", label: "工作账号", keyMasked: maskedKey() });
    } finally {
      await fx.cleanup();
    }
  });

  test("writeBigmodelUserName rejects blank keys and names", async () => {
    const fx = await createFixture();
    try {
      await expect(writeBigmodelUserName("  ", "name", fx.env)).rejects.toThrow();
      await expect(writeBigmodelUserName("key", "", fx.env)).rejects.toThrow();
      expect(await readBigmodelUserNames(fx.env)).toEqual({});
    } finally {
      await fx.cleanup();
    }
  });

  test("zcode identity prints the mapping tip for an unnamed bigmodel key", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      const code = await runIdentityCommand({ args: ["identity"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain(`API key ${maskedKey()}`);
      expect(fx.output.text()).toContain(bigmodelUsersPath(fx.env));
      expect(fx.output.text()).toContain("Tip:");
    } finally {
      await fx.cleanup();
    }
  });

  test("zcode identity shows the mapped name with the masked key, without a tip", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      await writeFile(bigmodelUsersPath(fx.env), JSON.stringify({ "e984bb0123456789abcdefVM9e": "工作账号" }));
      const code = await runIdentityCommand({ args: ["identity"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain(`API key 工作账号 (${maskedKey()})`);
      expect(fx.output.text()).not.toContain("Tip:");
    } finally {
      await fx.cleanup();
    }
  });

  test("zcode identity reports the signed-out state with the custom provider", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: { "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      const code = await runIdentityCommand({ args: ["identity"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain("Provider: bigmodel");
      expect(fx.output.text()).toContain("Identity: not signed in");
    } finally {
      await fx.cleanup();
    }
  });
});

describe("zcode identity set", () => {
  test("rewrites username and displayName while preserving other fields", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:user_info": encryptedUserInfo({
        id: "65241782030085862",
        username: "old-name",
        displayName: "old-name",
        avatarUrl: "https://cdn.bigmodel.cn/blob"
      }),
      "oauth:login_attribution": encryptCredential(JSON.stringify({ utm_source: "maas" }), secretEnv)
    }));
    try {
      const code = await runIdentityCommand({ args: ["identity", "set", "new-name"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain('updated to "new-name"');

      const vault = JSON.parse(await readFile(join(fx.home, ".zcode", "v2", "credentials.json"), "utf8"));
      const userInfo = JSON.parse(decryptCredential(vault["oauth:bigmodel:user_info"], fx.env));
      expect(userInfo.username).toBe("new-name");
      expect(userInfo.displayName).toBe("new-name");
      expect(userInfo.id).toBe("65241782030085862");
      expect(userInfo.avatarUrl).toBe("https://cdn.bigmodel.cn/blob");
      // Unrelated vault entries survive the rewrite.
      expect(decryptCredential(vault["oauth:login_attribution"], fx.env)).toBe(JSON.stringify({ utm_source: "maas" }));

      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "new-name" });
    } finally {
      await fx.cleanup();
    }
  });

  test("creates the user_info entry when only an API key exists", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      const code = await runIdentityCommand({ args: ["identity", "set", "fresh-name"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity).toEqual({ providerId: "bigmodel", kind: "oauth", label: "fresh-name" });
    } finally {
      await fx.cleanup();
    }
  });

  test("rejects a rename while signed out", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: { "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      const code = await runIdentityCommand({ args: ["identity", "set", "alice"], env: fx.env, output: fx.output });
      expect(code).toBe(1);
      expect(fx.output.text()).toContain("not signed in");
    } finally {
      await fx.cleanup();
    }
  });

  test("rejects a rename while signed in with an API key, pointing at the mapping", async () => {
    const fx = await createFixture();
    try {
      const code = await runIdentityCommand({ args: ["identity", "set", "alice"], env: fx.env, output: fx.output });
      expect(code).toBe(1);
      expect(fx.output.text()).toContain("signed in with an API key");
      expect(fx.output.text()).toContain(bigmodelUsersPath(fx.env));
    } finally {
      await fx.cleanup();
    }
  });

  test("rejects providers without an OAuth identity and overlong names", async () => {
    const fx = await createFixture(bigmodelLogin(), {
      model: { main: "custom/glm-5.3" },
      provider: { custom: { options: { apiKey: "abcd1234efgh5678" } } }
    });
    try {
      const code = await runIdentityCommand({ args: ["identity", "set", "alice"], env: fx.env, output: fx.output });
      expect(code).toBe(1);
      expect(fx.output.text()).toContain("no OAuth sign-in identity");
    } finally {
      await fx.cleanup();
    }

    const fx2 = await createFixture(bigmodelLogin());
    try {
      const code = await runIdentityCommand({
        args: ["identity", "set", "x".repeat(65)],
        env: fx2.env,
        output: fx2.output
      });
      expect(code).toBe(1);
      expect(fx2.output.text()).toContain("at most 64 characters");
    } finally {
      await fx2.cleanup();
    }
  });
});

describe("zcode identity show and clear", () => {
  test("shows the OAuth account name", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "shown-name", displayName: "shown-name" })
    }));
    try {
      const code = await runIdentityCommand({ args: ["identity"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain("Provider: bigmodel");
      expect(fx.output.text()).toContain("signed in as shown-name");
    } finally {
      await fx.cleanup();
    }
  });

  test("clear removes the snapshot and the identity falls back to the API key", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "bye-name", displayName: "bye-name" })
    }));
    try {
      const code = await runIdentityCommand({ args: ["identity", "clear"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity?.kind).toBe("apiKey");

      const vault = JSON.parse(await readFile(join(fx.home, ".zcode", "v2", "credentials.json"), "utf8"));
      expect(vault["oauth:bigmodel:user_info"]).toBeUndefined();
      expect(vault["oauth:active_provider"]).toBeDefined();
    } finally {
      await fx.cleanup();
    }
  });

  test("clear is a no-op without a stored snapshot", async () => {
    const fx = await createFixture(bigmodelLogin());
    try {
      const code = await runIdentityCommand({ args: ["identity", "clear"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain("nothing to clear");
    } finally {
      await fx.cleanup();
    }
  });

  test("show reports the missing state without a provider config", async () => {
    const fx = await createFixture({}, { provider: {} });
    try {
      const code = await runIdentityCommand({ args: ["identity"], env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain("No model access configured");
    } finally {
      await fx.cleanup();
    }
  });
});

describe("stale identity sweep after login", () => {
  test("readProviderApiKeySnapshot captures the vault-backed providers only", async () => {
    const fx = await createFixture({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "stale" })
    }, {
      model: { main: "bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        zai: { options: { apiKey: "" } },
        custom: { options: { apiKey: "custom-key" } }
      }
    });
    try {
      const snapshot = await readProviderApiKeySnapshot(fx.env);
      expect(snapshot).toEqual({ bigmodel: "e984bb0123456789abcdefVM9e" });
    } finally {
      await fx.cleanup();
    }
  });

  test("clearIdentitiesWithChangedKeys drops the snapshot when the key changed", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "old-account" }),
      "oauth:login_attribution": encryptCredential(JSON.stringify({ utm_source: "maas" }), secretEnv)
    }));
    try {
      const before = await readProviderApiKeySnapshot(fx.env);
      const newKey = "f105cc1234567890abcdefWN0f";
      await writeFile(
        userConfigPath(fx.env),
        JSON.stringify({
          model: { main: "bigmodel/glm-5.3" },
          provider: { bigmodel: { options: { apiKey: newKey } } }
        })
      );

      const cleared = await clearIdentitiesWithChangedKeys(before, fx.env);
      expect(cleared).toEqual(["bigmodel"]);

      const vault = JSON.parse(await readFile(join(fx.home, ".zcode", "v2", "credentials.json"), "utf8"));
      expect(vault["oauth:bigmodel:user_info"]).toBeUndefined();
      // The attribution entry and the provider marker survive.
      expect(vault["oauth:active_provider"]).toBeDefined();
      expect(vault["oauth:login_attribution"]).toBeDefined();

      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity?.kind).toBe("apiKey");
    } finally {
      await fx.cleanup();
    }
  });

  test("keeps the snapshot when the key is unchanged (same-account re-login)", async () => {
    const fx = await createFixture(bigmodelLogin({
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "same-account" })
    }));
    try {
      const before = await readProviderApiKeySnapshot(fx.env);
      const cleared = await clearIdentitiesWithChangedKeys(before, fx.env);
      expect(cleared).toEqual([]);
      const identity = await readLoginIdentitySnapshot(fx.env);
      expect(identity?.label).toBe("same-account");
    } finally {
      await fx.cleanup();
    }
  });

  test("clears the zai snapshot too when a pasted zai API key changed", async () => {
    const fx = await createFixture({
      "oauth:zai:user_info": encryptedUserInfo({ username: "zai-old" })
    }, {
      model: { main: "zai/glm-5.3" },
      provider: {
        zai: { options: { apiKey: "916cee0123456789abcdefVM9e" } },
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } }
      }
    });
    try {
      const before = await readProviderApiKeySnapshot(fx.env);
      await writeFile(
        userConfigPath(fx.env),
        JSON.stringify({
          model: { main: "zai/glm-5.3" },
          provider: {
            zai: { options: { apiKey: "82bbdf9876543210abcdefVM9e" } },
            bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } }
          }
        })
      );
      const cleared = await clearIdentitiesWithChangedKeys(before, fx.env);
      expect(cleared).toEqual(["zai"]);
    } finally {
      await fx.cleanup();
    }
  });

  test("reports nothing to clear without a stored snapshot", async () => {
    const fx = await createFixture();
    try {
      const before = await readProviderApiKeySnapshot(fx.env);
      await writeFile(
        userConfigPath(fx.env),
        JSON.stringify({
          model: { main: "bigmodel/glm-5.3" },
          provider: { bigmodel: { options: { apiKey: "f105cc1234567890abcdefWN0f" } } }
        })
      );
      const cleared = await clearIdentitiesWithChangedKeys(before, fx.env);
      expect(cleared).toEqual([]);
    } finally {
      await fx.cleanup();
    }
  });
});

describe("logout", () => {
  test("accepts the bare logout command only", () => {
    expect(isLogoutInvocation(["logout"])).toBe(true);
    expect(isLogoutInvocation(["logout", "--help"])).toBe(false);
    expect(isLogoutInvocation(["login"])).toBe(false);
    expect(isLogoutInvocation([])).toBe(false);
  });

  test("clears Z.AI and BigModel credentials but keeps unrelated entries", async () => {
    const fx = await createFixture({
      "oauth:active_provider": encryptCredential("bigmodel", secretEnv),
      "oauth:login_attribution": encryptCredential("bigmodel-oauth", secretEnv),
      "oauth:zai:access_token": "enc:v1:zai-token",
      "oauth:zai:refresh_token": "enc:v1:zai-refresh",
      "oauth:zai:user_info": "enc:v1:zai-user",
      "oauth:bigmodel:access_token": "enc:v1:bigmodel-token",
      "oauth:bigmodel:refresh_token": "enc:v1:bigmodel-refresh",
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "alice", displayName: "alice" }),
      zcodejwttoken: "enc:v1:jwt",
      zcodefeedbackclientid: "enc:v1:feedback"
    }, {
      model: { main: "bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "e984bb0123456789abcdefVM9e" } },
        "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } }
      }
    });
    try {
      const result = await clearOAuthLoginCredentials(fx.env);
      expect(result.cleared.sort()).toEqual([
        "config:bigmodel:apiKey",
        "oauth:active_provider",
        "oauth:bigmodel:access_token",
        "oauth:bigmodel:refresh_token",
        "oauth:bigmodel:user_info",
        "oauth:login_attribution",
        "oauth:zai:access_token",
        "oauth:zai:refresh_token",
        "oauth:zai:user_info",
        "zcodejwttoken"
      ].sort());
      const vault = JSON.parse(
        await readFile(join(fx.home, ".zcode", "v2", "credentials.json"), "utf8")
      ) as Record<string, string>;
      expect(Object.keys(vault)).toEqual(["zcodefeedbackclientid"]);
      const config = JSON.parse(await readFile(userConfigPath(fx.env), "utf8")) as {
        provider: Record<string, { options?: { apiKey?: string } }>;
      };
      // The official-slot key is login state and cleared; the custom-provider
      // slot keeps serving the signed-out state.
      expect(config.provider.bigmodel?.options?.apiKey).toBeUndefined();
      expect(config.provider["env-bigmodel"]?.options?.apiKey).toBe("e984bb0123456789abcdefVM9e");
    } finally {
      await fx.cleanup();
    }
  });

  test("is idempotent without a vault file", async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-logout-"));
    const env: NodeJS.ProcessEnv = { ...secretEnv, HOME: home };
    try {
      const result = await clearOAuthLoginCredentials(env);
      expect(result.cleared).toEqual([]);
      const code = await runLogoutCommand({ env });
      expect(code).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("reports the cleared providers on the command output", async () => {
    const fx = await createFixture({
      "oauth:bigmodel:access_token": "enc:v1:bigmodel-token",
      "oauth:bigmodel:user_info": encryptedUserInfo({ username: "alice", displayName: "alice" })
    });
    try {
      const code = await runLogoutCommand({ env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toBe(
        `Logged out from Z.AI and BigModel. Credentials: ${join(fx.home, ".zcode", "v2", "credentials.json")}\n`
      );
    } finally {
      await fx.cleanup();
    }
  });

  test("already logged out reports success without rewriting", async () => {
    const fx = await createFixture({}, {
      model: { main: "env-bigmodel/glm-5.3" },
      provider: { "env-bigmodel": { options: { apiKey: "e984bb0123456789abcdefVM9e" } } }
    });
    try {
      const code = await runLogoutCommand({ env: fx.env, output: fx.output });
      expect(code).toBe(0);
      expect(fx.output.text()).toContain("Already logged out.");
    } finally {
      await fx.cleanup();
    }
  });
});
