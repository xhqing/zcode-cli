# 需求：/model 与 /settings 模型选择器不再显示 env- 内部槽位前缀

需求名：`model-picker-env-prefix` · 项目：zcode-cli · 记录：2026-09-08（Hopper）

## 背景与问题

zcode-cli 支持通过 `~/.zcode/cli/custom-provider.env` 配置自定义模型供应商。配置同步进 config.json 时，供应商落在内部槽位 `env-<provider-id>`（如 `env-zai`），与官方登录槽位（`zai` / `bigmodel`）隔离——这是配置管道的内部实现，不是用户声明的名字。

现状问题（2026-09-08 实测确认）：

1. **`/model`（及 `/model list`）平铺列表**：官方槽位与 env 槽位重复的条目已被去重隐藏，但 **env 独有条目**（官方槽位没有的同名模型）以原始内部 id 显示，例如 `env-zai/glm-4.7`。
2. **`/settings → Model providers` 三级级联**：同一供应商被拆成两个重复的供应商组（官方 `zai` 一组、`env-zai` 一组，两组显示名还相同）；env 独有供应商（如 `env-openrouter`）在缺少 providerLabel 时组名直接显示带前缀的槽位名。

代码既有设计意图（`src/env-config.ts` 的 `displayProviderId` 注释）已明确：`env-` 前缀是配置管道，用户永远不该看到。本需求把显示层清理收尾。

## 需求条目（用户验收逐条核对清单）

用户已拍板（2026-09-08）：处理方式为**去掉前缀显示、条目保留可选**（不是隐藏条目）；范围覆盖 `/model` 平铺列表与 `/settings` 级联两处。

- [ ] **R1 · /model 平铺列表无 env- 前缀**：`/model` 打开的列表中，每个条目的显示名（label）、选项值（value）、生成的命令（`/model <id>`）一律为 `<provider>/<model>` 形式，任何位置不出现 `env-` 前缀。
- [ ] **R2 · env 独有条目保留可选**：去掉前缀是显示层变化，条目数量与可选能力不丢失——只用 custom-provider.env 的用户（未登录状态）仍能在 `/model` 里看到并选择自己配置的全部模型（含 `ZCODE_EXTRA_MODELS` 里的额外模型），显示为去前缀形式。选中后的会话切换走既有 `resolveModelSlotRef` 解析到实际有凭证的槽位，行为不变。
- [ ] **R3 · 级联合并同一供应商**：`/settings → Model providers` 中，官方槽位与 env 槽位并存的同一供应商合并为**一个**供应商组；组 id 与组名不带 `env-` 前缀；组内模型为两者去重后的并集。
- [ ] **R4 · env 独有供应商去前缀**：官方完全没有的供应商（如 custom-provider.env 配置的第三方）在级联中显示去前缀的供应商名；即使 runtime 未提供 providerLabel、组名退回 providerId，也不显示 `env-` 前缀。
- [ ] **R5 · current 标记与预选不回归**：保存的当前模型为 env 槽位内部形式（config.json 的 `model.main`，如 `env-zai/glm-5.2`）时，去前缀后的列表仍正确标记 `current` 并预选该条目（平铺列表与级联两处）。
- [ ] **R6 · 手输引用不回归**：`/model zai/glm-4.7` 这类去前缀形式的显式输入继续走既有解析路径，行为不变。
- [ ] **R7 · 选择路径防 3.8.1-31 事故（组合契约，随 R9 改写）**：未登录状态下，即使 runtime 上报的模型列表混入官方槽条目，`/model` 列表也**只含 env 槽（custom-provider.env）条目**（去前缀形式），且每一个条目经 `resolveModelSlotRef` 解析后都指向带凭证的 env 槽位——「列表显示对了、选择路径断了、选中后连不上上游」是 3.8.1-31 的实发事故（用户被迫回退版本），本需求及后续任何改动不得复现。
- [ ] **R8 · 去前缀条目的解析闭环**：env 独有条目去前缀显示后（value 为 `zai/glm-4.7` 形式），经 `resolveModelSlotRef` 必须解析回带凭证的 `env-zai` 槽——去前缀显示不许在选择路径上开新洞。
- [ ] **R9 · 未登录只显示 custom-provider.env 的模型（2026-09-08 用户追加）**：未登录状态下（无 vault 登录、官方槽无 key，即 `readSignedInProvider` 判定为未登录），`/model` 列表与 `/settings → Model providers` 级联**只显示 env 槽声明且带凭证的模型**（custom-provider.env 的 main / lite / EXTRA_MODELS 全集，去前缀显示）；官方槽位独有的模型（需登录才有凭证，如官方列表有而 custom-provider.env 未配置的型号）不显示。登录状态下行为不变（官方 + env 全量、去重）——登录后官方模型回到列表。
- [ ] **R10 · 未登录且无可用模型时的提示**：未登录且没有任何 env 槽可用模型（未配置 custom-provider.env 或其无凭证）时，`/model` 显示提示（语义：「无可切换模型：请登录或配置 custom-provider.env」，措辞可调），不弹空选择器、不静默无反应。

## 边界与非目标

- **config.json 内部存储不动**：`env-<provider>` 槽位名、`model.main` 的内部形式是配置管道，保持原样；本需求只改 TUI 显示层（selectors 的 label / value / 分组）。
- **既有去重行为保持**：官方槽位与 env 槽位同名模型仍然只显示一条（官方条目赢）；去前缀显示后不允许出现两条同值条目。
- **不要求** `/model env-zai/xxx` 带前缀形式的显式输入继续可用（内部形式暴露给用户本就是要消除的）。

## 给开发的注意点

- 核心改动集中在 `packages/zcode-tui/src/selectors.ts`：`modelPicker()`（label/value 用 `displayModelRef`）、`providerModelPicker()`（分组键用 `displayProviderId` 归并、组 value/label 去前缀）。既有工具函数 `displayProviderId` / `displayModelRef`（`src/env-config.ts`）与 `currentModelIds` 的双形式匹配已就位。
- **R9 过滤的签名建议**：`modelPicker(options, currentModel, signedIn?: boolean)` 与 `providerModelPicker(options, currentModel, signedIn?: boolean)`——`undefined` 保持现状兼容（不过滤），`false` 只留 env 槽条目，`true` 全量。签名形态是建议、行为契约（R9 断言）是硬约束：若采用别的签名，先与 Hopper 对齐再同步改用例。TUI 三个调用点（`showModelPicker`、`showModelProviderSettings`、快捷循环切换 `nextPickerValue(modelPicker(...))` 一处）用 `readSignedInProvider()`（`src/identity.ts`，TUI 已 import 同文件的 `resolveModelSlotRef`，无跨包障碍）取登录态传入；R10 的空列表提示在 `showModelPicker` 层实现（selector 返回空 items 时显示提示并返回）。
- **既有单元测试需要同步更新**：`test/selectors.test.ts` 的 `keeps env-file slot entries without an official twin`（约第 187 行）锁定了旧契约（env 独有条目 value 带前缀）。本需求显式废弃该契约，属行为变更而非「改测试迁就实现」——由开发随实现同步把该测试更新为去前缀断言。其余 selectors 既有测试（孪生去重、current 双形式匹配、全遮蔽组消失）预期不受影响，若变红请先核对本需求 R1–R10 再判断是回归还是契约连带变更。
- 选择路径依赖 `src/identity.ts` 的 `resolveModelSlotRef()`：对去前缀引用（`zai/glm-4.7`），官方槽位有凭证时落官方、否则落 env 槽位——已就位，无需改动，但 R2/R8 的端到端体验依赖它。

## 验收方式

- 机器门禁：`bun test` 全量，本需求组 `test-cases/pending/model-picker-env-prefix/` 全绿（passed 区不回归）。
- 人工门禁（用户）：
  - 未登录状态（custom-provider.env 配置、无 vault 登录、官方槽无 key）启动 TUI，输入 `/model` 核对**列表只含 custom-provider.env 配置的模型**、无 `env-` 前缀、无官方独有型号，且**逐条选择列表中的每个模型、确认实际能对话（连得上上游）**——3.8.1-31 的事故场景，人工验收必须覆盖；
  - 登录后再输入 `/model`，核对官方模型回到列表（全量、去重）；
  - 进 `/settings → Model providers` 核对同一供应商只有一个组、未登录时无官方槽供应商组。
