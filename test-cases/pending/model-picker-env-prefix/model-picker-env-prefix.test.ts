import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  explicitModelRequest,
  modelPicker,
  providerModelPicker
} from "../../../packages/zcode-tui/src/selectors.ts";
import { resolveModelSlotRef } from "../../../src/identity.ts";
import { userConfigPath } from "../../../src/model-access.ts";

/**
 * 验收用例 · model-picker-env-prefix
 *
 * 契约：/model 平铺列表与 /settings 级联中，内部 env-<provider> 槽位
 * 一律以去前缀形式显示；env 独有条目保留可选；current 标记不回归；
 * 未登录时列表只含 env 槽（custom-provider.env）条目、且每个条目都
 * 解析到带凭证的槽位（3.8.1-31 事故防护：列表显示对了、选择路径断了
 * ——连不上上游）。
 * 数据形态模拟 runtime listModels() 返回（{id, name, providerName} 与
 * {modelId, providerId, providerLabel} 两种既有格式均可触发本需求场景）。
 * 第三参 signedIn（建议签名，行为契约见 requirement.md R9）：undefined
 * 现状兼容、false 未登录（只留 env 槽条目）、true 登录（全量）。
 */

/** Signed-out fixture：临时 HOME、空 vault（无 OAuth 登录）、指定 config.json。 */
async function signedOutFixture(config: unknown): Promise<{
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  const home = await mkdtemp(join(tmpdir(), "zcode-acceptance-"));
  await mkdir(join(home, ".zcode", "v2"), { recursive: true });
  await mkdir(join(home, ".zcode", "cli"), { recursive: true });
  await writeFile(join(home, ".zcode", "v2", "credentials.json"), "{}");
  const env = { ZCODE_CREDENTIAL_SECRET: "test-secret", HOME: home } as NodeJS.ProcessEnv;
  await writeFile(userConfigPath(env), JSON.stringify(config));
  return { env, cleanup: async () => { await rm(home, { recursive: true, force: true }); } };
}

describe("model-picker-env-prefix (acceptance)", () => {
  test("R1: flat /model picker shows no env- prefix anywhere (signed in)", () => {
    const picker = modelPicker([
      { id: "zai/glm-5.2", name: "GLM 5.2", providerName: "Zai" },
      { id: "zai/glm-5-turbo", name: "GLM 5 Turbo", providerName: "Zai" },
      { id: "env-zai/glm-5.2", name: "GLM 5.2", providerName: "Zai" },
      { id: "env-zai/glm-4.7", name: "GLM 4.7", providerName: "Zai" },
      { id: "env-openrouter/llama-4", name: "Llama 4", providerName: "OpenRouter" }
    ], "zai/glm-5.2", true);

    for (const item of picker.items) {
      expect(item.value.startsWith("env-")).toBe(false);
      expect(item.label.startsWith("env-")).toBe(false);
      expect(item.command.includes("env-")).toBe(false);
    }

    // 官方孪生去重（官方赢）+ env 独有条目以去前缀形式保留
    expect(picker.items.map((item) => item.value)).toEqual([
      "zai/glm-5.2",
      "zai/glm-5-turbo",
      "zai/glm-4.7",
      "openrouter/llama-4"
    ]);
  });

  test("R2: signed-out env-only models stay selectable with prefix-free ids", () => {
    const picker = modelPicker([
      { id: "env-bigmodel/glm-5.3", name: "Glm 5.3" },
      { id: "env-custom/other-model" }
    ], undefined, false);

    expect(picker.items).toHaveLength(2);
    expect(picker.items[0]).toMatchObject({
      value: "bigmodel/glm-5.3",
      label: "bigmodel/glm-5.3",
      command: "/model bigmodel/glm-5.3"
    });
    expect(picker.items[1]).toMatchObject({ value: "custom/other-model" });
  });

  test("R3: settings cascade merges official and env slot groups of one provider", () => {
    const cascade = providerModelPicker([
      { modelId: "glm-5.2", providerId: "zai", providerLabel: "Zai", name: "GLM 5.2" },
      { modelId: "glm-5-turbo", providerId: "zai", providerLabel: "Zai", name: "GLM 5 Turbo" },
      { modelId: "glm-5.2", providerId: "env-zai", providerLabel: "Zai", name: "GLM 5.2" },
      { modelId: "glm-4.7", providerId: "env-zai", providerLabel: "Zai", name: "GLM 4.7" }
    ], "zai/glm-5.2", true);

    expect(cascade!.providers.items.map((item) => item.value)).toEqual(["zai"]);

    const group = cascade!.groups.find((g) => g.providerId === "zai")!;
    expect(group.models.items).toHaveLength(3);
    expect([...group.models.items.map((item) => item.value)].sort()).toEqual(
      ["zai/glm-4.7", "zai/glm-5-turbo", "zai/glm-5.2"].sort()
    );
    for (const item of group.models.items) {
      expect(item.value.startsWith("env-")).toBe(false);
    }
  });

  test("R4: env-only providers appear without the prefix (even signed out)", () => {
    const cascade = providerModelPicker([
      { modelId: "llama-4", providerId: "env-openrouter", name: "Llama 4" },
      { modelId: "qwen-3", providerId: "env-openrouter", name: "Qwen 3" }
    ], undefined, false);

    expect(cascade!.providers.items.map((item) => item.value)).toEqual(["openrouter"]);
    expect(cascade!.providers.items[0]!.label.startsWith("env-")).toBe(false);

    const group = cascade!.groups[0]!;
    expect(group.models.items.map((item) => item.value)).toEqual([
      "openrouter/llama-4",
      "openrouter/qwen-3"
    ]);
  });

  test("R5: current marking and preselection survive the prefix-free display", () => {
    const picker = modelPicker([
      { id: "env-zai/glm-5.2", name: "GLM 5.2" },
      { id: "env-zai/glm-5-turbo", name: "GLM 5 Turbo" }
    ], "env-zai/glm-5-turbo", false);

    expect(picker.items[picker.selectedIndex]!.value).toBe("zai/glm-5-turbo");
    expect(picker.items[picker.selectedIndex]!.description).toContain("current");

    const cascade = providerModelPicker([
      { modelId: "glm-5.2", providerId: "env-zai", name: "GLM 5.2" },
      { modelId: "glm-5-turbo", providerId: "env-zai", name: "GLM 5 Turbo" }
    ], "env-zai/glm-5.2", false);

    expect(cascade!.providers.items[cascade!.providers.selectedIndex]!.value).toBe("zai");
    const group = cascade!.groups.find((g) => g.providerId === "zai")!;
    expect(group.models.items[group.models.selectedIndex]!.value).toBe("zai/glm-5.2");
  });

  test("R6: explicit /model refs keep working in prefix-free form", () => {
    expect(explicitModelRequest("/model zai/glm-4.7")).toBe("zai/glm-4.7");
  });

  /**
   * R7 · 3.8.1-31 事故防护（组合契约，随 R9 改写）：未登录状态下，即使
   * runtime 上报的模型列表混入官方槽条目（登出后 listModels 仍会报官方
   * 槽），/model 列表也只含 env 槽条目（去前缀形式），且每个条目经
   * resolveModelSlotRef 解析到带凭证的 env 槽——否则选中后连不上上游
   * （3.8.1-31 实发事故，用户被迫回退版本）。
   */
  test("R7: signed-out list keeps only env-slot entries and each resolves to the env slot", async () => {
    const fx = await signedOutFixture({
      model: { main: "bigmodel/glm-5.3" },
      provider: {
        bigmodel: { options: { apiKey: "  " } },
        "env-bigmodel": {
          options: { apiKey: "test-env-key" },
          models: { "glm-5.3": { name: "Glm 5.3" }, "glm-5-turbo": { name: "Glm 5 Turbo" } }
        }
      }
    });
    try {
      const picker = modelPicker([
        { id: "bigmodel/glm-5.3", name: "Glm 5.3" },
        { id: "bigmodel/glm-5-turbo", name: "Glm 5 Turbo" },
        { id: "env-bigmodel/glm-5.3", name: "Glm 5.3" },
        { id: "env-bigmodel/glm-5-turbo", name: "Glm 5 Turbo" }
      ], "bigmodel/glm-5.3", false);

      expect(picker.items.map((item) => item.value)).toEqual([
        "bigmodel/glm-5.3",
        "bigmodel/glm-5-turbo"
      ]);
      for (const item of picker.items) {
        const resolved = await resolveModelSlotRef(item.value, fx.env);
        expect(resolved).toBe(`env-bigmodel/${item.value.split("/")[1]}`);
      }
    } finally {
      await fx.cleanup();
    }
  });

  /**
   * R8 · 本需求的组合契约：env 独有条目去前缀显示后，其 value（zai/glm-4.7
   * 形式）经 resolveModelSlotRef 必须解析回带凭证的 env 槽——去前缀显示
   * 不许在选择路径上开新洞。
   */
  test("R8: prefix-free env-only entries resolve to the credentialed env slot", async () => {
    const fx = await signedOutFixture({
      model: { main: "env-zai/glm-5.2" },
      provider: {
        zai: { options: { apiKey: "  " } },
        "env-zai": {
          options: { apiKey: "test-env-key" },
          models: { "glm-5.2": { name: "GLM 5.2" }, "glm-4.7": { name: "GLM 4.7" } }
        }
      }
    });
    try {
      const picker = modelPicker([
        { id: "env-zai/glm-5.2", name: "GLM 5.2" },
        { id: "env-zai/glm-4.7", name: "GLM 4.7" }
      ], "env-zai/glm-5.2", false);

      expect(picker.items.length).toBeGreaterThan(0);
      for (const item of picker.items) {
        const resolved = await resolveModelSlotRef(item.value, fx.env);
        expect(resolved).toBe(`env-zai/${item.value.split("/")[1]}`);
      }
    } finally {
      await fx.cleanup();
    }
  });

  /**
   * R9 · 未登录只显示 custom-provider.env 的模型：官方槽独有条目
   * （需登录才有凭证，如官方 glm-5.3-flash 而自定义文件未配置）不显示；
   * 登录态全量回归（官方模型回到列表）。
   */
  test("R9: signed-out picker lists only env-slot models; signed-in keeps the full list", () => {
    const options = [
      { id: "bigmodel/glm-5.3", name: "Glm 5.3" },
      { id: "bigmodel/glm-5-turbo", name: "Glm 5 Turbo" },
      { id: "bigmodel/glm-5.3-flash", name: "Glm 5.3 Flash" },
      { id: "env-bigmodel/glm-5.3", name: "Glm 5.3" },
      { id: "env-bigmodel/glm-5-turbo", name: "Glm 5 Turbo" }
    ];

    const signedOut = modelPicker(options, "bigmodel/glm-5.3", false);
    expect(signedOut.items.map((item) => item.value)).toEqual([
      "bigmodel/glm-5.3",
      "bigmodel/glm-5-turbo"
    ]);

    const signedIn = modelPicker(options, "bigmodel/glm-5.3", true);
    expect(signedIn.items.map((item) => item.value)).toEqual([
      "bigmodel/glm-5.3",
      "bigmodel/glm-5-turbo",
      "bigmodel/glm-5.3-flash"
    ]);
  });

  test("R9: signed-out cascade drops official-only models and provider groups", () => {
    const cascade = providerModelPicker([
      { modelId: "glm-5.3", providerId: "bigmodel", providerLabel: "BigModel", name: "Glm 5.3" },
      { modelId: "glm-5.3-flash", providerId: "bigmodel", providerLabel: "BigModel", name: "Glm 5.3 Flash" },
      { modelId: "glm-5.3", providerId: "env-bigmodel", providerLabel: "BigModel", name: "Glm 5.3" },
      { modelId: "glm-4.7", providerId: "env-openrouter", providerLabel: "OpenRouter", name: "Glm 4.7" }
    ], "bigmodel/glm-5.3", false);

    // 官方独有型号（glm-5.3-flash）与纯官方供应商组消失；env 槽模型保留
    expect(cascade!.providers.items.map((item) => item.value)).toEqual(["bigmodel", "openrouter"]);
    const bigmodelGroup = cascade!.groups.find((g) => g.providerId === "bigmodel")!;
    expect(bigmodelGroup.models.items.map((item) => item.value)).toEqual(["bigmodel/glm-5.3"]);
    const openrouterGroup = cascade!.groups.find((g) => g.providerId === "openrouter")!;
    expect(openrouterGroup.models.items.map((item) => item.value)).toEqual(["openrouter/glm-4.7"]);
  });

  /**
   * R10 · 未登录且无任何 env 槽可用模型：picker 为空（showModelPicker 层
   * 依此显示「请登录或配置 custom-provider.env」提示——提示语行为由
   * requirement.md 人工验收覆盖，此处锁 selector 层返回空）。
   */
  test("R10: signed-out picker is empty when only official-slot models exist", () => {
    const picker = modelPicker([
      { id: "bigmodel/glm-5.3", name: "Glm 5.3" },
      { id: "zai/glm-5.2", name: "GLM 5.2" }
    ], "bigmodel/glm-5.3", false);

    expect(picker.items).toHaveLength(0);
  });
});
