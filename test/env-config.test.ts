import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildProviderConfig,
  envFilePath,
  parseEnvFileContent,
  resolveUpstreamBaseURL,
  syncEnvFileToConfig
} from "../src/env-config.ts";
import { placeholderApiKey } from "../src/key-failover.ts";
import { userConfigPath } from "../src/model-access.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "zcode-env-config-"));
  temporaryDirectories.push(home);
  return home;
}

function homeEnvironment(home: string): NodeJS.ProcessEnv {
  return { HOME: home, USERPROFILE: home };
}

const completeEnvFile = [
  "ZCODE_PROVIDER_ID=bigmodel",
  "ZCODE_PROVIDER_KIND=anthropic",
  "ZCODE_BASE_URL=https://open.bigmodel.cn/api/anthropic",
  "ZCODE_API_KEY=test-key",
  "ZCODE_MAIN_MODEL=glm-5.2",
  "ZCODE_LITE_MODEL=glm-5-turbo"
].join("\n");

describe("env file path", () => {
  test("resolves the default location and honors ZCODE_ENV_FILE", () => {
    expect(envFilePath({ HOME: "/home/alice" }, "linux", "/fallback")).toBe("/home/alice/.zcode/cli/.env");
    expect(envFilePath({ USERPROFILE: "C:\\Users\\Alice" }, "win32", "C:\\fallback")).toBe(
      "C:\\Users\\Alice\\.zcode\\cli\\.env"
    );
    expect(envFilePath({ HOME: "/home/alice", ZCODE_ENV_FILE: "/custom/zcode.env" }, "linux")).toBe(
      "/custom/zcode.env"
    );
  });
});

describe("parseEnvFileContent", () => {
  test("parses assignments, comments, quotes and unknown keys", () => {
    const values = parseEnvFileContent([
      "# header comment",
      "",
      "ZCODE_API_KEY=plain-key",
      "ZCODE_API_KEY_2=plain-backup",
      "ZCODE_PROVIDER_NAME=\"Quoted Name\"",
      "ZCODE_MAIN_MODEL='single-quoted'",
      "OTHER_VARIABLE=ignored",
      "not-an-assignment",
      "ZCODE_LITE_MODEL=",
      "  ZCODE_BASE_URL = https://example.com/api  "
    ].join("\n"));

    expect(values).toEqual({
      ZCODE_API_KEY: "plain-key",
      ZCODE_API_KEY_2: "plain-backup",
      ZCODE_PROVIDER_NAME: "Quoted Name",
      ZCODE_MAIN_MODEL: "single-quoted",
      ZCODE_BASE_URL: "https://example.com/api"
    });
  });
});

describe("buildProviderConfig", () => {
  test("applies defaults for zai without extra variables", () => {
    const built = buildProviderConfig({ ZCODE_API_KEY: "key", ZCODE_MAIN_MODEL: "glm-5.2" });
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.providerId).toBe("zai");
    expect(built.provider).toEqual({
      kind: "anthropic",
      name: "Zai",
      options: {
        apiKey: "key",
        apiKeyRequired: true,
        baseURL: "https://api.z.ai/api/anthropic"
      },
      models: { "glm-5.2": { name: "Glm 5.2" } }
    });
    expect(built.model).toEqual({ main: "zai/glm-5.2", lite: "zai/glm-5.2" });
  });

  test("declares extra models and validates inputs", () => {
    const built = buildProviderConfig({
      ZCODE_PROVIDER_ID: "bigmodel",
      ZCODE_API_KEY: "key",
      ZCODE_MAIN_MODEL: "glm-5.2",
      ZCODE_EXTRA_MODELS: "glm-5.2,glm-5-turbo:Turbo, glm-5.1"
    });
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(Object.keys(built.provider.models as Record<string, unknown>)).toEqual([
      "glm-5.2",
      "glm-5-turbo",
      "glm-5.1"
    ]);
    expect(built.model.main).toBe("bigmodel/glm-5.2");

    const invalidProviderId = buildProviderConfig({
      ZCODE_API_KEY: "key",
      ZCODE_PROVIDER_ID: "Bad ID",
      ZCODE_MAIN_MODEL: "glm-5.2"
    });
    expect("error" in invalidProviderId && invalidProviderId.error).toContain("ZCODE_PROVIDER_ID");
    const invalidKind = buildProviderConfig({
      ZCODE_API_KEY: "key",
      ZCODE_PROVIDER_KIND: "grpc",
      ZCODE_MAIN_MODEL: "glm-5.2"
    });
    expect("error" in invalidKind && invalidKind.error).toContain("ZCODE_PROVIDER_KIND");
    const missingBaseUrl = buildProviderConfig({
      ZCODE_API_KEY: "key",
      ZCODE_PROVIDER_ID: "custom",
      ZCODE_MAIN_MODEL: "model"
    });
    expect("error" in missingBaseUrl && missingBaseUrl.error).toContain("ZCODE_BASE_URL");
  });

  test("rewrites multi-key values to the failover proxy", () => {
    const built = buildProviderConfig(
      {
        ZCODE_PROVIDER_ID: "bigmodel",
        ZCODE_API_KEY: "key-a",
        ZCODE_API_KEY_2: "key-b",
        ZCODE_API_KEY_3: "key-a",
        ZCODE_MAIN_MODEL: "glm-5.2"
      },
      { proxyBaseURL: "http://127.0.0.1:7849/api/anthropic" }
    );
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.provider.options).toEqual({
      apiKey: placeholderApiKey,
      apiKeyRequired: true,
      baseURL: "http://127.0.0.1:7849/api/anthropic"
    });
    expect(built.failover).toEqual({ proxyBaseURL: "http://127.0.0.1:7849/api/anthropic", keyCount: 2 });
  });

  test("multi-key without a proxy degrades to the first key", () => {
    const built = buildProviderConfig({
      ZCODE_API_KEY: "key-a",
      ZCODE_API_KEY_2: "key-b",
      ZCODE_MAIN_MODEL: "glm-5.2"
    });
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.provider.options).toEqual({
      apiKey: "key-a",
      apiKeyRequired: true,
      baseURL: "https://api.z.ai/api/anthropic"
    });
    expect(built.failover).toBeUndefined();
  });
});

describe("resolveUpstreamBaseURL", () => {
  test("prefers ZCODE_BASE_URL and falls back to provider defaults", () => {
    expect(resolveUpstreamBaseURL({ ZCODE_BASE_URL: "https://example.com/api" })).toBe("https://example.com/api");
    expect(resolveUpstreamBaseURL({})).toBe("https://api.z.ai/api/anthropic");
    expect(resolveUpstreamBaseURL({ ZCODE_PROVIDER_ID: "bigmodel" })).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(resolveUpstreamBaseURL({ ZCODE_PROVIDER_ID: "custom" })).toBeUndefined();
  });
});

describe("syncEnvFileToConfig", () => {
  test("writes provider and model blocks into config.json", async () => {
    const home = await temporaryHome();
    const env = homeEnvironment(home);
    await mkdir(dirname(envFilePath(env)), { recursive: true });
    await writeFile(envFilePath(env), completeEnvFile);

    const result = await syncEnvFileToConfig(env);
    expect(result.applied).toBe(true);
    expect(result.error).toBeUndefined();

    const config = JSON.parse(await readFile(userConfigPath(env), "utf8"));
    expect(config.model).toEqual({ main: "bigmodel/glm-5.2", lite: "bigmodel/glm-5-turbo" });
    expect(config.provider.bigmodel.options).toEqual({
      apiKey: "test-key",
      apiKeyRequired: true,
      baseURL: "https://open.bigmodel.cn/api/anthropic"
    });
  });

  test("writes the failover proxy into config.json for multi-key files", async () => {
    const home = await temporaryHome();
    const env = homeEnvironment(home);
    await mkdir(dirname(envFilePath(env)), { recursive: true });
    await writeFile(envFilePath(env), [
      "ZCODE_PROVIDER_ID=bigmodel",
      "ZCODE_API_KEY=key-a",
      "ZCODE_API_KEY_2=key-b",
      "ZCODE_API_KEY_3=key-c",
      "ZCODE_MAIN_MODEL=glm-5.2"
    ].join("\n"));

    const result = await syncEnvFileToConfig(env, {
      failoverProxyBaseURL: "http://127.0.0.1:7849/api/anthropic"
    });
    expect(result.applied).toBe(true);
    expect(result.failover).toEqual({ proxyBaseURL: "http://127.0.0.1:7849/api/anthropic", keyCount: 3 });

    const config = JSON.parse(await readFile(userConfigPath(env), "utf8"));
    expect(config.provider.bigmodel.options).toEqual({
      apiKey: placeholderApiKey,
      apiKeyRequired: true,
      baseURL: "http://127.0.0.1:7849/api/anthropic"
    });
  });

  test("keeps unrelated providers and config blocks untouched", async () => {
    const home = await temporaryHome();
    const env = homeEnvironment(home);
    const configDirectory = dirname(userConfigPath(env));
    await mkdir(configDirectory, { recursive: true });
    await writeFile(userConfigPath(env), JSON.stringify({
      provider: {
        zai: { options: { apiKey: "oauth-key" }, models: { "glm-5.2": { name: "GLM-5.2" } } }
      },
      model: { main: "zai/glm-5.2", lite: "zai/glm-5-turbo" },
      modelStream: { idleTimeoutMs: 60000 },
      permission: { mode: "build" }
    }));
    await writeFile(envFilePath(env), completeEnvFile);

    await syncEnvFileToConfig(env);

    const config = JSON.parse(await readFile(userConfigPath(env), "utf8"));
    expect(config.provider.zai).toEqual({
      options: { apiKey: "oauth-key" },
      models: { "glm-5.2": { name: "GLM-5.2" } }
    });
    expect(config.provider.bigmodel).toBeDefined();
    expect(config.modelStream).toEqual({ idleTimeoutMs: 60000 });
    expect(config.permission).toEqual({ mode: "build" });
  });

  test("skips silently without a file and reports validation errors", async () => {
    const home = await temporaryHome();
    const env = homeEnvironment(home);

    const missing = await syncEnvFileToConfig(env);
    expect(missing.applied).toBe(false);
    expect(missing.error).toBeUndefined();

    await mkdir(dirname(envFilePath(env)), { recursive: true });
    await writeFile(envFilePath(env), "ZCODE_API_KEY=key\n# no model selected\n");

    const invalid = await syncEnvFileToConfig(env);
    expect(invalid.applied).toBe(false);
    expect(invalid.error).toBe("ZCODE_MAIN_MODEL is not set");
  });

  test("ignores files without model settings", async () => {
    const home = await temporaryHome();
    const env = homeEnvironment(home);
    await mkdir(dirname(envFilePath(env)), { recursive: true });
    await writeFile(envFilePath(env), "SOMETHING_ELSE=value\n");

    const result = await syncEnvFileToConfig(env);
    expect(result.applied).toBe(false);
    expect(result.error).toBeUndefined();
  });
});
