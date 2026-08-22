# Changelog

本项目所有值得注意的变更都记录在此文件中。

## Unreleased（自 3.8.1-15 起）

### 变更

- **移除 fork 前原作者的个人相关信息**（package.json、scripts/check-package.ts、test/release-package.test.ts、packages/zcode-tui/src/update-available-view.ts、README.md、docs/assets/demo.svg）。
  - 为什么改：本仓库是从上游原仓库 fork 而来的个人维护版本，仓库里残留原作者的 npm 作者字段、邮箱、仓库地址与录屏里的个人路径 / 昵称，与当前仓库归属不符。
  - 改了什么：package.json 的 `author` 改为 `All Contributors`，`homepage` / `bugs` / `repository` 全部指向 `xhqing/zcode-cli`；check-package.ts 与 release-package.test.ts 中对应校验值同步更新；TUI 更新卡片的 release notes 链接改为本仓库；README.md「参与贡献」段仓库地址更新；demo.svg 录屏文本中的原作者用户名、个人文件路径等长替换为本仓库路径（保持 SVG 布局不变）。`bun run build:tui` 重建后 dist 与 vendor 内的链接同步更新（两文件逐字节一致）。
- **README 新增项目 LOGO、补齐标准徽章、删除 npm 徽章**（README.md、README_cn.md、assets/logo.svg 新建）。
  - 为什么改：项目 README 缺少 LOGO；npm version / npm downloads 两枚徽章指向原作者发布通道、不再适用；按项目标配应含 License / Version / Type 三枚标准徽章。
  - 改了什么：新建 640×200 青蓝渐变色卡 LOGO（终端 `>_` 主题，圆角 rx=28，assets/logo.svg），插入两版 README 顶部；删除两枚 npm 徽章，补 License（MIT）、Version（3.8.1-15，链接 CHANGELOG）、Type（CLI Tool）三枚静态徽章。

## 3.8.1-15

### 变更

- **修复未登录状态启动 TUI 立即崩溃、无法进入交互界面输 `/login` 的问题**（`scripts/sync-runtime.ts` 的 `patchRuntimeTuiBridge`）。
  - 为什么改：配置文件 `~/.zcode/cli/config.json` 里 `apiKey` 为空、且没有 `model` 字段时（即「未登录」状态），TUI 本应显示「Model access is not configured / Run /login」并停在交互界面等用户登录。但 TUI 启动时无条件调用 `subscribeSessionEvents`，落到 runtime 里注入的桥接代码 `getApp().then(...)`——该 Promise 后面没有 `.catch()`。未登录时 `getApp()` 必然抛出 `ModelProtocolError: model_config_missing`，变成 unhandled rejection，Node 默认的 strict 模式直接终止进程（exit 1），用户还没来得及输 `/login` 就退出了。
  - 改了什么：给 `subscribeSessionEvents` 桥接的 `getApp().then(...)` 补上 `.catch(()=>{})`——登录未完成时订阅会话事件本来就无意义，静默忽略即可；用户登录成功后重新进入的调用路径不受影响。
  - 验证：在临时 HOME（空 `apiKey` 配置）下复现原崩溃（exit 1 + `ModelProtocolError` 堆栈），打补丁后同样环境 TUI 常驻待输入界面，`/login` 能正常打开「Set Up Coding Plan」选择器。

## 3.8.1-14 及更早

历史版本记录见 git 提交历史（本项目此前未维护 CHANGELOG.md，自 3.8.1-15 起补建）。
