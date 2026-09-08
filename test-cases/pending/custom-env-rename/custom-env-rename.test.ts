import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { envFilePath, migrateLegacyEnvFile } from "../../../src/env-config.ts";

/**
 * 验收用例 · custom-env-rename
 *
 * 契约：自定义供应商配置文件默认路径改为 ~/.zcode/cli/custom.env；
 * 旧名（custom-provider.env 与更早的 .env）在启动时自动迁移；
 * 新旧并存不丢数据（新名生效、旧文件保留）；ZCODE_ENV_FILE 覆盖时
 * 一切迁移跳过。解析 / 同步语义零变化由既有单测 + 机器门禁兜底。
 */

interface Fixture {
  home: string;
  cliDir: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

async function fixture(overrides: Record<string, string> = {}): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "zcode-rename-"));
  const cliDir = join(home, ".zcode", "cli");
  await mkdir(cliDir, { recursive: true });
  for (const [name, content] of Object.entries(overrides)) {
    await writeFile(join(cliDir, name), content);
  }
  const env = { HOME: home } as NodeJS.ProcessEnv;
  return { home, cliDir, env, cleanup: async () => { await rm(home, { recursive: true, force: true }); } };
}

describe("custom-env-rename (acceptance)", () => {
  test("R1: default path is custom.env under the cli dir (posix and win32 home rules)", async () => {
    const fx = await fixture();
    try {
      expect(envFilePath(fx.env, "darwin", fx.home)).toBe(join(fx.home, ".zcode", "cli", "custom.env"));
      const winEnv = { USERPROFILE: "C:\\Users\\u" } as NodeJS.ProcessEnv;
      expect(envFilePath(winEnv, "win32", fx.home)).toBe("C:\\Users\\u\\.zcode\\cli\\custom.env");
    } finally {
      await fx.cleanup();
    }
  });

  test("R2: custom-provider.env is renamed to custom.env with content preserved", async () => {
    const fx = await fixture({ "custom-provider.env": "ZCODE_PROVIDER_ID=zai\nZCODE_API_KEY=test\n" });
    try {
      const migrated = await migrateLegacyEnvFile(fx.env);
      expect(migrated).toBe(join(fx.cliDir, "custom.env"));
      await expect(readFile(join(fx.cliDir, "custom-provider.env"), "utf8")).rejects.toThrow();
      expect(await readFile(join(fx.cliDir, "custom.env"), "utf8")).toBe("ZCODE_PROVIDER_ID=zai\nZCODE_API_KEY=test\n");
    } finally {
      await fx.cleanup();
    }
  });

  test("R2: legacy .env migrates straight to custom.env", async () => {
    const fx = await fixture({ ".env": "ZCODE_MAIN_MODEL=glm-5.2\n" });
    try {
      const migrated = await migrateLegacyEnvFile(fx.env);
      expect(migrated).toBe(join(fx.cliDir, "custom.env"));
      expect(await readFile(join(fx.cliDir, "custom.env"), "utf8")).toBe("ZCODE_MAIN_MODEL=glm-5.2\n");
    } finally {
      await fx.cleanup();
    }
  });

  test("R2: ZCODE_ENV_FILE override skips migration entirely", async () => {
    const fx = await fixture({ "custom-provider.env": "ZCODE_MAIN_MODEL=glm-5.2\n" });
    try {
      const override = join(fx.home, "elsewhere.env");
      const env = { ...fx.env, ZCODE_ENV_FILE: override } as NodeJS.ProcessEnv;
      expect(await migrateLegacyEnvFile(env)).toBeUndefined();
      expect(await readFile(join(fx.cliDir, "custom-provider.env"), "utf8")).toBe("ZCODE_MAIN_MODEL=glm-5.2\n");
      await expect(readFile(join(fx.cliDir, "custom.env"), "utf8")).rejects.toThrow();
    } finally {
      await fx.cleanup();
    }
  });

  test("R3: coexisting custom.env and custom-provider.env keeps both, no rename", async () => {
    const fx = await fixture({
      "custom.env": "ZCODE_MAIN_MODEL=glm-5.2\n",
      "custom-provider.env": "ZCODE_MAIN_MODEL=glm-4.7\n"
    });
    try {
      expect(await migrateLegacyEnvFile(fx.env)).toBeUndefined();
      expect(await readFile(join(fx.cliDir, "custom.env"), "utf8")).toBe("ZCODE_MAIN_MODEL=glm-5.2\n");
      expect(await readFile(join(fx.cliDir, "custom-provider.env"), "utf8")).toBe("ZCODE_MAIN_MODEL=glm-4.7\n");
    } finally {
      await fx.cleanup();
    }
  });
});
