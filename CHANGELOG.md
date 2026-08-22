# Changelog

本项目所有值得注意的变更都记录在此文件中。

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
