# zcode-cli 待办清单（活跃）

> 本文件**只放未完成、要尽快处理**的待办（`[ ]` 开头）——「还有哪些没做」一眼全览。
> 已完成 / 已更新的条目移入 `TODO-archive.md` 归档保留（勿删）。
> **优先级分类**：条目按 🔴 红色紧急度 / 🟠 橙色紧急度 / 🟡 黄色紧急度 / 🟢 绿色紧急度四级分节排列（红色最紧急在前），每条待办写入时必须判断所属级别并放进对应分节；颜色只标在分节标题、条目本身不标颜色 emoji；判断拿不准往高靠。
> 每条待办带记录时间戳（精确到分钟）与唯一编号（**T+序号**，全局递增、永不复用，新条目编号 = TODO.md 与 TODO-archive.md 出现过的最大编号 + 1，两文件都扫）。

## 🟠 橙色紧急度（边界情况出错 / 防护缺口 / 口径不一致，排在红色紧急度之后计划处理）

- [ ] **T1** **会话 bootstrap 传 `workspaceHookTrustEnabled: true`——启用 runtime 既有项目级 workspace hooks 信任体系（当前 zcode-cli 从不传该参数 → runtime 侧恒 false → 项目级 hooks 整体禁用）**。**为什么**：DayTradingAgent（Victor）2026-09-03 T137/T140 端到端验证发现——runtime 已内置完整信任体系（状态机 `pending_trust → trusted_persistent`、声明 sha256 + bundle 摘要绑定、持久 trust store `workspace-hook-trust-v1.json`、`zcode hooks trust status/grant/revoke` 命令族），且用户已用 CLI grant 完成授信（trust store 持久化），但 zcode-cli 构造会话时**从未传 `workspaceHookTrustEnabled`**（`n = e.workspaceHookTrustEnabled === !0`，客户端源码 grep 零命中）→ `enabled: false` → grant 后的新会话日志仍全部打 `workspace_hook.feature_disabled`。后果：各工作区 `.zcode/config.json` 的项目级 hooks 一直不执行，DayTradingAgent 被迫把两条安全 hook（凭证守卫 secret_guard / CHANGELOG 提醒 changelog_guard）挂到**用户级** `~/.zcode/cli/config.json` 兜底——该路径脆弱：2026-09-04 实测一次客户端设置保存用旧配置快照整体重写用户级 config.json、把挂载冲掉（当日已恢复并实证），项目级单源才是稳态。**做什么**：会话 bootstrap 构造 runtime 时传 `workspaceHookTrustEnabled: true`。**定位材料（2026-09-03 晚排查，DayTradingAgent T140 沉淀）**：`vendor/zcode.cjs` 构造点 offset≈11703354（`len()` 附近）、bootstrap 消费点 ≈11762913、runtime 内部 `workspaceHookTrustEnabled:!0` 参考样例 ≈11922028（带 reviewHost 的完整构造）；headless 场景可不传 reviewHost——授权走 CLI grant 已持久化。**完成后验证口径**（DayTradingAgent 侧配合，对应其 TODO T140 ②③）：新 ZCode 会话重跑 cat 凭证探针（应仍被拦、且改由项目级挂载拦截）+ 日志无 `feature_disabled` → DayTradingAgent 撤回用户级两条上移、切回项目级单源。**同源风险提示（可顺带评估）**：2026-09-04 事故显示「客户端设置保存会用进程内存中的旧配置快照整体重写 config.json、丢弃外部对 hooks 段的修改」——设置保存宜改为「读盘合并」或至少保留 hooks 段，否则用户级 hooks 挂载随时可能被旧快照进程冲掉（是否立项由本项目裁定，不强制并入 T1）。（记录：2026-09-04 12:07，由 DayTradingAgent T140 拆转登记）
