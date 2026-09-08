# 需求：自定义供应商配置文件改名 custom-provider.env → custom.env

需求名：`custom-env-rename` · 项目：zcode-cli · 记录：2026-09-08（Hopper）

## 背景与问题

zcode-cli 的自定义供应商配置文件 `~/.zcode/cli/custom-provider.env`（dotenv 风格，模板 `custom-provider.env.example`）文件名偏长——`provider` 是上下文已知的冗余修饰词。按用户文件命名规范（2026-08-10 立：文件名尽可能简单、删冗余修饰、语义不丢为底线），简化为 **`custom.env`**。

现状引用面（2026-09-08 全仓摸底）：代码 7 个文件（`src/env-config.ts` 的 `customProviderEnvFileName` 常量为唯一文件名源、`src/launcher.ts` 迁移调用、`src/identity.ts`、TUI 包 3 个源文件）、测试 5 个文件、`docs/CONFIGURATION.md` / `docs/DEVELOPMENT.md`、README 三版、仓库模板 `custom-provider.env.example`，合计 41 处代码引用；**用户本机实际存在该文件**——存量迁移是刚需，不是理论需求。

## 需求条目（用户验收逐条核对清单）

- [ ] **R1 · 默认路径改为 `~/.zcode/cli/custom.env`**：不设 `ZCODE_ENV_FILE` 时，配置文件默认路径为 `<home>/.zcode/cli/custom.env`（Windows 用 `%USERPROFILE%`，既有平台规则不变）。
- [ ] **R2 · 存量自动迁移（两层 legacy）**：`custom.env` 不存在时，启动自动迁移——`custom-provider.env` 存在 → rename 为 `custom.env`；否则 `.env`（更早的 legacy 名）存在 → rename 为 `custom.env`。迁移发生时提示用户（沿用现有 launcher 的 console.log 提示模式，措辞跟着新名字走）。`ZCODE_ENV_FILE` 设置时跳过一切迁移（既有行为不变）。
- [ ] **R3 · 新旧并存不丢数据**：`custom.env` 与 `custom-provider.env` 同时存在 → 新名生效、旧名文件**保留不动**（提示用户旧文件已不再读取、可自行处置——不擅自删除用户文件）。
- [ ] **R4 · 模板与文档同步**：仓库模板改名 `custom-provider.env.example` → `custom.env.example`；README 三版、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md`、代码注释中的文件名引用全部同步，全仓不再出现旧名（CHANGELOG 历史条目除外——历史记录不改写）。
- [ ] **R5 · 配置语义零变化**：文件解析（`parseEnvFileContent`）、同步进 config.json（`syncEnvFileToConfig`）、多 key failover、`env-<provider>` 槽位写入等行为不因改名变化——既有单元测试（`test/env-config.test.ts` 等）改名适配后原语义全绿，由机器门禁兜底。

## 边界与非目标

- **`config.json` 内部 `env-<provider>` 槽位名不变**：那是配置槽位约定，与配置文件名无关（`model-picker-env-prefix` 需求组正在处理的 `env-` 前缀是槽位显示问题，两组互不阻塞、独立开发归档）。
- **`ZCODE_ENV_FILE` 覆盖路径的行为不变**：显式指定路径时读写该路径、不迁移。
- **`model-picker-env-prefix` 需求组文档中的 `custom-provider.env` 字样为立项时名称**，本需求落地后自动对应 `custom.env`，不回头改写历史需求文档。
- 旧名文件在「只存在旧名」场景下被 rename 走（等价于内容搬家，无数据丢失）；「新旧并存」场景旧文件保留（R3）。

## 给开发的注意点

- 文件名唯一权威源是 `src/env-config.ts` 的 `customProviderEnvFileName` 常量——改常量 + 扩展 `migrateLegacyEnvFile` 的迁移链（`.env` / `custom-provider.env` → `custom.env`，优先迁更新的旧名）+ launcher 提示文案；其余 41 处引用多为注释 / 文档 / 测试 fixture 字符串，逐一同步。
- 迁移链实现建议：`custom.env` 存在 → 跳过；`custom-provider.env` 存在 → rename 它；否则 `.env` 存在 → rename 它（一次启动最多一次 rename，与现有 `migrateLegacyEnvFile` 语义同构，只是 legacy 清单多一层）。
- TUI 包（`packages/zcode-tui`）与 `scripts/smoke-tui.ts` 里的引用主要是注释与提示文案，随实现同步。

## 验收方式

- 机器门禁：`bun test` 全量，本需求组 `test-cases/pending/custom-env-rename/` 全绿 + 既有测试（改名适配后）全绿、passed 区不回归。
- 人工门禁（用户）：
  - 本机（存在旧名文件）安装新版启动 → 提示 rename、`~/.zcode/cli/custom.env` 就位且内容与原文件一致、旧名文件消失；
  - 启动后自定义供应商配置照常生效（`/model` 列表正常出模型、能对话）；
  - 手工构造「新旧并存」→ 新名生效、旧文件保留、有提示。
