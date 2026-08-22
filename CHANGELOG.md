# Changelog

本项目所有值得注意的变更都记录在此文件中。

## 3.8.1-15

### 变更

- **修复未登录状态启动 TUI 立即崩溃、无法进入交互界面输 `/login` 的问题**（`scripts/sync-runtime.ts` 的 `patchRuntimeTuiBridge`）。
  - 为什么改：配置文件 `~/.zcode/cli/config.json` 里 `apiKey` 为空、且没有 `model` 字段时（即「未登录」状态），TUI 本应显示「Model access is not configured / Run /login」并停在交互界面等用户登录。但 TUI 启动时无条件调用 `subscribeSessionEvents`，落到 runtime 里注入的桥接代码 `getApp().then(...)`——该 Promise 后面没有 `.catch()`。未登录时 `getApp()` 必然抛出 `ModelProtocolError: model_config_missing`，变成 unhandled rejection，Node 默认的 strict 模式直接终止进程（exit 1），用户还没来得及输 `/login` 就退出了。
  - 改了什么：给 `subscribeSessionEvents` 桥接的 `getApp().then(...)` 补上 `.catch(()=>{})`——登录未完成时订阅会话事件本来就无意义，静默忽略即可；用户登录成功后重新进入的调用路径不受影响。
  - 验证：在临时 HOME（空 `apiKey` 配置）下复现原崩溃（exit 1 + `ModelProtocolError` 堆栈），打补丁后同样环境 TUI 常驻待输入界面，`/login` 能正常打开「Set Up Coding Plan」选择器。

## 3.8.1-14 及更早

历史版本记录见 git 提交历史（本项目此前未维护 CHANGELOG.md，自 3.8.1-15 起补建）。
