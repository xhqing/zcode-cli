# Changelog

本项目所有值得注意的变更都记录在此文件中。

## 3.8.1-17

### 新增

- **`~/.zcode/cli/.env` 扁平环境文件配置——免手改 config.json 的模型接入方式**（src/env-config.ts 新建、src/launcher.ts、.env.example 新建、.gitignore、test/env-config.test.ts 新建、docs/CONFIGURATION.md、README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：用户要配置直连 API key 此前只有手改嵌套 `config.json` 一条路（provider/model 两个块、模型 ID 大小写、provider ID 须为 `zai`/`bigmodel` 等约束都埋在 JSON 里，2026-08-23 用户就因从 OpenCode 抄来 `builtin:bigmodel` key + 缺 `model` 块而配置无效）；提供一份带详细注释的扁平 `.env` 模板，复制到 `~/.zcode/cli/.env` 填两个必填项（`ZCODE_API_KEY`、`ZCODE_MAIN_MODEL`）即可用，降低配置门槛、避免抄错格式。
  - 改了什么：① 新建 src/env-config.ts——dotenv 风格解析（`KEY=value`、`#` 注释、引号剥离、未知变量忽略），`buildProviderConfig()` 校验并生成 provider/model 配置块（provider ID 默认 `zai`、kind 默认 `anthropic`、`zai`/`bigmodel` 有默认 baseURL、lite 模型缺省回落 main 模型、`ZCODE_EXTRA_MODELS` 支持 `id:显示名` 条目并自动补齐所选模型的声明）；② launcher 启动早期（ensureUserConfig 之后、login 检测与 runtime 拉起之前）调 `syncEnvFileToConfig()`——`.env` 是其自身 provider 条目与 `model` 块的权威源，合并写入 config.json，其它 provider（如 OAuth 登录写入的凭证）与其余配置块不动；无 `.env` / 无模型设置项时静默跳过，校验失败（如缺 `ZCODE_MAIN_MODEL`）则以明确报错退出（exit 1），同步成功会清除 setup-pending（首启向导不再弹出）；③ `.env` 路径默认 `~/.zcode/cli/.env`、`ZCODE_ENV_FILE` 可覆盖；④ 新建 `.env.example` 模板（每项变量带用途、默认值、取值示例与「provider ID 须为 `zai`/`bigmodel` 否则登录门禁不放行」等关键约束的英文注释），`.gitignore` 加 `.env` 防密钥误提交；⑤ 新增 test/env-config.test.ts 共 8 个用例（路径解析、dotenv 解析、build 校验与默认值、同步写入、无关块保留、缺文件静默、校验报错、无模型设置忽略）；⑥ 文档：CONFIGURATION.md 新增「Environment file (.env)」小节并在模型接入路径列表挂链、三版 README 配置节各加一段说明。
- **欢迎横幅当前目录改为完整绝对路径显示**（packages/zcode-tui/src/welcome-banner.ts、test/welcome-banner.test.ts）。
  - 为什么改：横幅信息面板宽度上限原为 52 列、路径 + branch 放不下时用「砍头」截断（`…rs/xhq/Documents/...`），绝对路径开头的 `/Users/...` 被砍掉，用户看不出这是绝对路径（尤其中文 macOS 默认路径 `/Users/<名>/Documents/...` 较长，宽终端上也截头）。
  - 改了什么：① 信息面板宽度上限 52 → 72；② `locationLine()` 重写截断策略——完整路径 + 完整 branch 放得下就原样显示；放不下先压缩 branch（路径保完整）；实在不行路径截尾（保留开头 `/`，砍掉的是尾部），不再砍头；③ 紧凑模式 location 行同步由砍头改为截尾；④ 删除无调用方的 `truncateFromStart()`；⑤ 测试新增「绝对路径开头保留」断言（80 列完整显示、48 列截尾保头）。`bun run build:tui` 重建 dist。

- **TUI 欢迎横幅常驻退出提示 + `/quit` 补进斜杠命令补全**（packages/zcode-tui/src/welcome-banner.ts、packages/zcode-tui/src/index.ts、test/welcome-banner.test.ts）。
  - 为什么改：退出命令只认 `/quit` / `/exit`（带斜杠前缀），用户在界面里输入裸的 `quit` / `exit` / `quit()` 会被当作普通聊天消息发给模型——模型未配置时（Model config is missing）全部被拦截返回报错，看起来像「quit 失灵」，界面上又没有任何退出方式提示，新用户只能干瞪眼。
  - 改了什么：① 欢迎横幅信息面板（宽横幅模式）与紧凑横幅各加一行常驻 muted 提示 `/quit │ Ctrl+D to exit`——宽横幅由 4 行变 5 行（品牌 Z 标志 4 行不够铺满第 5 行，改为信息面板驱动行数、Z 标志不足处补空格）、紧凑横幅由 2 行变 3 行；② `autocompleteCommands()` 的本地命令表在 `exit` 之外补上 `quit` 条目（此前输入 `/q` 无补全提示）；③ welcome-banner 测试断言同步（行数 4→5、2→3）并新增退出提示文案断言。`bun run build:tui` 重建 dist。
- **新增繁體中文版 README，语言导航三语化**（README_zh_tw.md 新建、README.md、README_cn.md）。
  - 为什么改：README 原只有英文 + 简体双语；用户要求补繁体版本，覆盖繁体中文读者。
  - 改了什么：以简体版为底本整体转写繁体（台/港常用术语：套件 / 設定 / 外掛 / 檔案 / 指令 等），代码块、命令与链接保持原样；三版头部语言导航统一为「English | 简体中文 | 繁體中文」互链。
- **README 头部改为居中排版（LOGO / 徽章 / 语言导航）**（README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：用户要求项目 LOGO、标准徽章、语言链接在 README 里居中展示。
  - 改了什么：三版 README 的标题下方用 `<div align="center">` 包裹 LOGO、三枚标准徽章（License / Version / Type）与语言导航行。
- **项目展示名统一为「ZCode CLI」**（README.md、README_cn.md、README_zh_tw.md、assets/logo.svg）。
  - 为什么改：用户要求 README 项目名称与 LOGO 内项目名统一用「ZCode CLI」（此前 README 标题为小写 `zcode-cli`、LOGO 文字为 `zcode-cli_`）。
  - 改了什么：三版 README 的 `# 标题`、LOGO / demo 图 alt 文本、「安装与更新」节的展示名表述改为 **ZCode CLI**；LOGO 主标题文字改为 `ZCode CLI_`、aria-label 同步。
- **项目 LOGO 重设计：左侧大写 Z + 赛博朋克风格**（assets/logo.svg）。
  - 为什么改：用户要求 LOGO 左侧图形改用大写「Z」、整体走赛博朋克设计风格（原为青蓝渐变色卡 + 终端 `>_` 主题）。
  - 改了什么：深蓝紫渐变底（#0B0E1F → #1B1033）+ 极淡青色网格线（裁剪进圆角框内）；大写 Z 主体为青色渐变（#67E8F9 → #22D3EE）+ 高斯模糊霓虹发光 + 切角笔画；品红色（#E879F9）错位残影与两道 glitch 切片制造故障感；右侧主标题 `ZCode CLI_`（青色 + 白色 + 光标下划线）配灰色副标题。外轮廓保持 640×200 圆角矩形 rx=28（符合 icon-design 规范）。
- **发布构建产物名统一为 `zcode-cli-<version>.tgz`**（scripts/pack-release.ts、src/update.ts、.github/workflows/publish.yml、test/update.test.ts、test/release-workflows.test.ts、README.md、README_cn.md、README_zh_tw.md、docs/RELEASING.md）。
  - 为什么改：Release asset 名原跟随 npm 包名（`zcode-app-cli-<version>.tgz`），与项目展示名 ZCode CLI 不一致；用户要求产物名统一为 `zcode-cli-{version}.tgz`。
  - 改了什么：① pack-release.ts 在 `npm pack` 产出后将 tarball 由包名重命名为 `zcode-cli-<version>.tgz`，`release.json` 的 `tarball` 路径随之变化；② update.ts 新增 `releaseAssetName()`（单一命名口径），`gh release download --pattern` 与下载期望路径改用它，进度输出同步；③ publish.yml 两处 `gh release upload` 改传 `.release/zcode-cli-${PACKAGE_VERSION}.tgz`；「Rebuild tarball」步骤在 `cmp` 比对前把重 pack 出的包名 tarball 重命名回 asset 名，避免改名后比对必然失败；④ 测试同步（update.test.ts 改用 `releaseAssetName` 并新增命名断言、release-workflows.test.ts 两处 upload 断言改为字面 asset 名）；⑤ 三版 README 与 docs/RELEASING.md 的产物名表述同步。**注意**：npm 包名 `zcode-app-cli` 与包内安装路径不变——重命名只影响 Release asset 文件名。

## 3.8.1-16

### 变更

- **版本号由 3.8.1-15 bump 到 3.8.1-16**（VERSION、package.json、README.md、README_cn.md、test/update.test.ts、CHANGELOG.md）。
  - 为什么改：CHANGELOG 顶部积压了 Unreleased 段（--update 自更新、rebrand、LOGO 等），按 docs/RELEASING.md 规范，发布本地 feature 前须递增 build 号；且 npm 上原作者 kingsword09 已发布同名的 3.8.1-15（内容与本地 HEAD 不同），bump 到 -16 避免与原作者发布通道的同名版本混淆。
  - 改了什么：VERSION、package.json `version` 字段、两版 README 徽章、test/update.test.ts 的版本期望串、CHANGELOG Unreleased 段定稿为 `## 3.8.1-16`，全部同步为 3.8.1-16。

### 新增

- **`zcode --update` / `zcode update` 自更新命令——GitHub Release 为唯一渠道**（src/update.ts 新建、src/launcher.ts、test/update.test.ts 新建、packages/zcode-tui/src/update-available-view.ts、.github/workflows/publish.yml、test/release-workflows.test.ts、README.md、README_cn.md）。
  - 为什么改：此前更新只能手动执行 `npm install -g zcode-app-cli@latest`，用户（含本人多机）每次更新都要记命令、敲长命令；参照 CC-BRIDGE 的 `cc-bridge update` 体验，本地一条命令即可从**本人仓库的 GitHub Release** 拉取最新版安装（用户明确要求只走自己的 GitHub Release，不走 npm——即使仓库暂无 Release 也不回退 npm，避免装到非本人发布的内容）。
  - 改了什么：新建 src/update.ts——经 `gh` CLI 查询 xhqing/zcode-cli 的 GitHub Release 最新 tag（`gh release view`），`gh release download` 下载对应的 `zcode-app-cli-<版本>.tgz` asset，`npm install -g <tarball>` 重装；无 Release / 无 asset / gh 未装未登录时报可操作的错误（提示先发 Release、或手动到 Releases 页下载、或 `gh auth status` 排查），**不回退 npm**。版本比较复用 scripts/release-version.ts 的 `compareReleaseVersions`，已是最新则提示退出。launcher.ts 在 version 分发后新增 `isUpdateInvocation` 分发（仅接受单参数 `update` / `--update`，不与官方 runtime 子命令冲突——已实测官方 runtime 无 `update` 子命令）。TUI 更新卡片提示命令改为 `zcode --update`。**publish.yml 的 Release 创建步骤补挂 tgz asset**（`gh release upload`，Release 已存在时也补挂）——此前 Release 不带 asset，`--update` 无从下载；test/release-workflows.test.ts 同步断言两个上传步骤。新增 test/update.test.ts 共 9 个用例（调用识别、asset 下载与缺失报错、无 npm 回退、更新跳过、launcher 分发集成）。

### 变更

- **用户可见文案统一以 `zcode-cli` 展示，npm 功能性标识保持 `zcode-app-cli`**（src/update.ts、src/launcher.ts、src/update-check.ts、packages/zcode-tui/src/update-available-view.ts、README.md、README_cn.md、docs/DEVELOPMENT.md、docs/CONFIGURATION.md、docs/RELEASING.md、test/update.test.ts、test/launcher.test.ts、test/update-check.test.ts）。
  - 为什么改：仓库 / 项目展示名已是 `zcode-cli`，但 `--update` 进度、`--version` 输出、TUI 更新卡片等用户可见文案仍显示 npm 包名 `zcode-app-cli`，两套命名混用让用户困惑；统一展示为 `zcode-cli`。
  - 改了什么：`--update` 输出「Checking for zcode-cli updates…」、下载进度行改为「Downloading zcode-cli <版本> (zcode-app-cli-<版本>.tgz)…」；`--version` 首行改为 `zcode-cli <版本>`；npm registry 探测的 User-Agent 改为 `zcode-cli/<版本>`；TUI 更新卡片备注改为「(npm package: zcode-app-cli)」；README 双语与 docs 三篇的展示性提法同步（并注明 npm 包名为 `zcode-app-cli`、`zcode-cli` 名字在 npm 已被无关包占用）。**功能性标识不动**：package.json `name`、npm registry URL（`registry.npmjs.org/zcode-app-cli/latest`）、`npm view/pack` 查询、tarball 文件名（`zcode-app-cli-<版本>.tgz`）、`node_modules/zcode-app-cli` 安装路径、test/release-package.test.ts 与 scripts/smoke-package.ts 中的包名 / 路径断言——这些直接决定安装与自更新链路查到 / 装到哪个包，改了会拉到 npm 上别人的 `zcode-cli@0.0.1`。
- **README 标题（首个项目名称）由 `zcode-app-cli` 改为 `zcode-cli`**（README.md、README_cn.md）。
  - 为什么改：仓库已更名 / 品牌化为 `zcode-cli`（repo 元数据已指向 xhqing/zcode-cli），README 开头的项目名称应与仓库名一致；`zcode-app-cli` 只是 npm 包名，不作为项目展示名。
  - 改了什么：两版 README 的 `# 标题` 同步改为 `zcode-cli`（中英双语内容保持同步）。
- **修正 test/sync-runtime.test.ts 的存量断言失败**（test/sync-runtime.test.ts）。
  - 为什么改：e1c299f 给 `subscribeSessionEvents` 桥接补 `.catch(()=>{})` 时只改了 scripts/sync-runtime.ts 的注入模板、漏改测试期望串，导致「injects transcript and structured state readers」用例在干净 HEAD 上也失败（已实测 e1c299f 提交点裸跑即失败，与本次 `--update` 改动无关）。
  - 改了什么：测试期望串补上 `.catch(()=>{})` 与注入模板对齐，全量 552 个测试恢复 0 失败。
- **移除 fork 前原作者的个人相关信息**（package.json、scripts/check-package.ts、test/release-package.test.ts、packages/zcode-tui/src/update-available-view.ts、README.md、docs/assets/demo.svg）。
  - 为什么改：本仓库是从上游原仓库 fork 而来的个人维护版本，仓库里残留原作者的 npm 作者字段、邮箱、仓库地址与录屏里的个人路径 / 昵称，与当前仓库归属不符。
  - 改了什么：package.json 的 `author` 改为 `All Contributors`，`homepage` / `bugs` / `repository` 全部指向 `xhqing/zcode-cli`；check-package.ts 与 release-package.test.ts 中对应校验值同步更新；TUI 更新卡片的 release notes 链接改为本仓库；README.md「参与贡献」段仓库地址更新；demo.svg 录屏文本中的原作者用户名、个人文件路径等长替换为本仓库路径（保持 SVG 布局不变）。`bun run build:tui` 重建后 dist 与 vendor 内的链接同步更新（两文件逐字节一致）。
- **README 新增项目 LOGO、补齐标准徽章、删除 npm 徽章**（README.md、README_cn.md、assets/logo.svg 新建）。
  - 为什么改：项目 README 缺少 LOGO；npm version / npm downloads 两枚徽章指向原作者发布通道、不再适用；按项目标配应含 License / Version / Type 三枚标准徽章。
  - 改了什么：新建 640×200 青蓝渐变色卡 LOGO（终端 `>_` 主题，圆角 rx=28，assets/logo.svg），插入两版 README 顶部；删除两枚 npm 徽章，补 License（MIT）、Version（3.8.1-16，链接 CHANGELOG）、Type（CLI Tool）三枚静态徽章。

## 3.8.1-15

### 变更

- **修复未登录状态启动 TUI 立即崩溃、无法进入交互界面输 `/login` 的问题**（`scripts/sync-runtime.ts` 的 `patchRuntimeTuiBridge`）。
  - 为什么改：配置文件 `~/.zcode/cli/config.json` 里 `apiKey` 为空、且没有 `model` 字段时（即「未登录」状态），TUI 本应显示「Model access is not configured / Run /login」并停在交互界面等用户登录。但 TUI 启动时无条件调用 `subscribeSessionEvents`，落到 runtime 里注入的桥接代码 `getApp().then(...)`——该 Promise 后面没有 `.catch()`。未登录时 `getApp()` 必然抛出 `ModelProtocolError: model_config_missing`，变成 unhandled rejection，Node 默认的 strict 模式直接终止进程（exit 1），用户还没来得及输 `/login` 就退出了。
  - 改了什么：给 `subscribeSessionEvents` 桥接的 `getApp().then(...)` 补上 `.catch(()=>{})`——登录未完成时订阅会话事件本来就无意义，静默忽略即可；用户登录成功后重新进入的调用路径不受影响。
  - 验证：在临时 HOME（空 `apiKey` 配置）下复现原崩溃（exit 1 + `ModelProtocolError` 堆栈），打补丁后同样环境 TUI 常驻待输入界面，`/login` 能正常打开「Set Up Coding Plan」选择器。

## 3.8.1-14 及更早

历史版本记录见 git 提交历史（本项目此前未维护 CHANGELOG.md，自 3.8.1-15 起补建）。
