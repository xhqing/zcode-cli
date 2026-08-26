# Changelog

本项目所有值得注意的变更都记录在此文件中。

## 3.8.1-19

### 变更

- **`ZCODE_API_KEY` 支持多 key 容灾：本地回环代理按 key 轮换重试**（src/key-failover.ts 新建、src/env-config.ts、src/launcher.ts、.env.example、test/key-failover.test.ts 新建、test/env-config.test.ts、docs/CONFIGURATION.md、README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：用户要求多把 bigmodel coding plan key 做容灾——端点不变、同一端点下配多把 key，某把 key 的请求失败时直接切换另一把继续；此前每个 provider 只支持单 key，key 失效 / 限流只能手动换。多 key 的配置格式同日由「`ZCODE_API_KEY` 逗号分隔多把 key」改为「每把 key 一个变量」（用户裁定：不要一个变量里逗号分隔）。
  - 改了什么：① 多把 key 每把一个变量：主 key 仍是 `ZCODE_API_KEY`，备用 key 用编号变量 `ZCODE_API_KEY_2`、`ZCODE_API_KEY_3`……（按编号升序去重合并；解析宽容收集任意 `ZCODE_API_KEY_<正整数>`）；`.env.example` 模板以注释变量行 `#ZCODE_API_KEY_2=`、`#ZCODE_API_KEY_3=` 直接列出备用 key 变量，取消注释填值即可启用。多于一把时 launcher 在拉起 runtime 前启动只绑 127.0.0.1 的本地容灾代理（端口从 7849 起找空闲，避免多实例冲突），并把 `.env` 同步写入 config.json 的 provider 条目改写为：baseURL 指向代理（保留上游端点路径）、apiKey 写占位符 `zcode-failover`——真实 key 只存在于 `.env` 文件与代理内存，不落 config.json。② 代理逐请求注入当前 key（替换 x-api-key / authorization 的值，其余 header 原样透传）：上游返回 401/403/429/5xx 或连接失败时，换下一把 key 用同一请求体重试，成功（含 2xx 与不可切换的 4xx）后流式透传响应（SSE 不受影响）并记住健康 key 作为下次起点；全部 key 失败则回传最后一次上游响应，runtime 自带的重试与报错逻辑不受影响。③ 切换事件追加记录到 `~/.zcode/cli/key-failover.log`（key 脱敏为前 4 + 后 4 位，超 1 MiB 轮转），不打终端以免扰乱 TUI。④ 单 key 时行为与原来完全一致（直连、无代理）。⑤ 测试：新建 test/key-failover.test.ts 共 12 个用例（key 变量合并 / 脱敏、401 切换 + 健康 key 记忆、全败回传、上游不可达 502、4xx 透传不切换、流式透传、占位凭证替换、健康端点、端口冲突递增、少于两把 key 报错），env-config 测试补多 key 构建 / 降级 / 端点解析 / 同步写入用例；全量 598 测试通过、typecheck 与 `bun run check` 通过。⑥ 沙箱端到端实测：两把假 key 打真实 bigmodel 端点，确认 runtime 请求打到代理（`http://127.0.0.1:7849/api/anthropic/v1/messages`）、config.json 写入占位 key 与代理地址、日志记录 key#0 → 401 → failover → key#1 → 401 → 回传（变量格式调整后复测通过）。注意：多把 key 必须同属一个端点（容灾只轮换 key，不改端点）。

- **项目根新增软链接 `AGENTS.md` → `.claude/CLAUDE.md`**（AGENTS.md 新建）。
  - 为什么改：AGENTS.md 是多家 agent 工具（如 ZCode 等）的项目级指令约定入口，读取的是项目根 `AGENTS.md`；此前本项目指南只存在于 `.claude/CLAUDE.md`（Claude Code 的入口），其它工具读不到。用软链接打通后两套入口共享同一份内容，单一源头维护、不会两处分叉。
  - 改了什么：`ln -s .claude/CLAUDE.md AGENTS.md`（相对路径软链接，clone 到任何机器都有效）；`.claude/CLAUDE.md` 本身不动。
- **欢迎横幅品牌 Z 标志回退为简约单色版（撤销赛博朋克双层残影）**（packages/zcode-tui/src/welcome-banner.ts、packages/zcode-tui/src/theme.ts、test/welcome-banner.test.ts）。
  - 为什么改：3.8.1-18 把横幅 Z 标志改成了「青色 Z + 品红错位残影」的赛博朋克双层结构（与项目 LOGO 同风格），用户试用后要求横幅里的 Z 图像回归之前的简约模式、不要赛博朋克风。
  - 改了什么：① 删除 `BRAND_GHOST` 残影层与逐列合并渲染（`mergeBrandLine()` / `brandMarkLine()` / `brandCell()`），`BRAND_MARK` 回到 4 行 10 列的单层块画 Z，直接以 accent 色整体着色；② theme.ts 删除 `brandGhost` 主题色（唯一调用方就是残影层，无其它引用）；③ 测试同步：双层残影用例改回单层块画断言、删除品红 ghost 颜色断言、48 列截断断言随标志宽度 12 → 10 列调整。`bun run build:tui` 重建 dist。
- **新增 `zcode stats` 用量统计子命令：按 provider 聚合 token 与积分消耗**（src/usage.ts 新建、src/env-config.ts、src/launcher.ts、test/usage.test.ts 新建、test/env-config.test.ts、.env.example、README.md、README_cn.md、README_zh_tw.md、docs/CONFIGURATION.md）。
  - 为什么改：① 用户要求用量统计且明确统计内容为输入 token、缓存命中 token、缓存命中率、输出 token，以及输入 / 缓存 / 输出三项消耗积分——此前 TUI 只有单会话退出时的 token 汇总行，不落盘、无积分；命令名用户指定为 `zcode stats`；② 积分口径要与 ZCode Desktop 一致——逆向 Desktop host 进程确认其「个人套餐」页积分来自 BigModel monitor 接口（`credit-usage/usage-detail`，需 OAuth 双 JWT，CLI 端 runtime 无此调用），但官方公开文档（docs.bigmodel.cn/cn/coding-plan/overview）给出了同一套抵扣公式与系数，Desktop 的「应用用量」页同样按本地历史估算，故采用官方系数本地估算，口径一致且无需鉴权；③ 曾按「每把 key 起名（`ZCODE_KEY_NAME`）分组」实现，用户随后裁定撤销按 key 分组——统计维度回归 provider。
  - 改了什么：① 新建 src/usage.ts——Node 22 内置 `node:sqlite` 只读打开 `~/.zcode/cli/db/db.sqlite`，按 provider 聚合 `model_usage` 的 input / cache_read / output token 与请求数、错误数（key 脱敏为前 4 + 后 4 位，`builtin:` 前缀 OAuth 套餐标注 built-in plan），计算缓存命中率（命中 ÷ 输入侧总量）；按官方 GLM Coding Plan 系数（GLM-5.3/5.2/5.1 = 6.9/1.7/24、GLM-5-Turbo = 5.7/1.5/21、GLM-4.7 = 4.6/1.2/16，积分 = token × 系数 ÷ 10000，非高峰时段（工作日 14:00–18:00 UTC+8 之外）按 50% 抵扣）逐请求估算输入 / 缓存 / 输出三项积分并汇总；无系数表的模型跳过积分并标注 `estimated`；② launcher 路由 `zcode stats` / `zcode stats --json`；③ 文档同步（.env.example、三版 README「用量统计」节、CONFIGURATION.md「Usage stats per API key」节）。`bun run build:launcher` 重建，本机实测 OAuth 套餐 / bigmodel key / 自定义 provider 各自成组、命中率与积分输出正确。
- **`zcode stats` 积分估算新增促销倍率 `ZCODE_STATS_CREDIT_MULTIPLIER`**（src/usage.ts、src/env-config.ts、test/usage.test.ts、test/env-config.test.ts、.env.example、README.md、README_cn.md、README_zh_tw.md、docs/CONFIGURATION.md）。
  - 为什么改：用户指出积分按官方系数表硬算不可行——官方存在限时折扣（如 ZCode 限时 1.5 倍用量 ≈ 67% 积分抵扣，至 2026-08-31），且问「zcode-cli 会被官方认定为 ZCode 享受该优惠吗」；查证（本机 rollout 记录的实际请求头）确认 zcode-cli 的模型请求由官方原版 runtime 发出、自带 `User-Agent: ZCode/<版本>`、`x-zcode-app-version` 等标识，服务端按 ZCode 认定、优惠同样适用；但服务端响应不含实际扣减积分数（raw_usage_json 只有 token），本地估算需显式叠加折扣系数。
  - 改了什么：① `.env` 新增 `ZCODE_STATS_CREDIT_MULTIPLIER`（默认 1，促销期设如 `0.67`），同步写入 config.json 的 `usage.creditMultiplier`；② `zcode stats` 的积分估算在该倍率上缩放，报告标题与每 key 积分行标注 `(×0.67 promo multiplier)`；③ 测试补促销倍率用例（computeCredits 乘数、config 读取、报告标注），全量 579 测试通过。
  - **后续撤销（同日）**：monitor 真实积分接入后用户裁定「不要自己算，要官方后端的真实数据」，该倍率机制整体移除（见下方撤销条目）。
- **`zcode stats` 新增厂商真实积分报告：用 `zcode login` 存下的 OAuth 凭据直调 BigModel monitor 接口**（src/usage.ts、test/usage.test.ts、README.md、README_cn.md、README_zh_tw.md、docs/CONFIGURATION.md）。
  - 为什么改：用户追问「真实积分只在 BigModel monitor 接口里（需 OAuth 双 JWT）——拿不到 OAuth 双 JWT 吗」；查证发现拿得到——`zcode login` 登录后双 JWT 就存本机共享凭据库 `~/.zcode/v2/credentials.json`（`zcodejwttoken` + `oauth:bigmodel:access_token`，AES-256-GCM `enc:v1:` 加密，密钥为本机可派生的 fallback 口令 SHA-256，与 runtime 同算法）；实测解密后仅用 `oauth:bigmodel:access_token` 一个 `authorization` 头即可调通 `bigmodel.cn/api/monitor/credit-usage/usage-detail`（与 ZCode Desktop 用量页同源接口），拿到服务端记账的真实积分（已含促销与非高峰折扣）。
  - 改了什么：① src/usage.ts 新增 `decryptCredential()`（runtime 同款 AES-256-GCM 解密，`ZCODE_CREDENTIAL_SECRET` 可覆盖密钥）、`credentialsFilePath()`、`fetchBigModelSpendReport()`（读凭据 → 解 BigModel token → 调 monitor 近 30 天 usage-detail；逐小时数组字段按 `sumSeries()` 求和；任何失败返回 undefined）；② `runStatsReport()` 先试拉真实积分（`options.fetchSpendReport` 可测试注入），成功则报告末尾追加「Vendor spend report (real credits)」段——按模型列真实总积分 + 输入 / 缓存 / 输出三桶积分 + token 数，本地估算行同步标注 `(estimated)` 以示区分；无凭据 / 网络失败静默省略、退回纯本地估算；③ 测试补 5 个用例（凭据路径、加解密往返、monitor 响应解析含数组求和、失败降级、报告段渲染），全量 583 测试通过。本机实测输出：近 30 天真实消耗 118,308.9 积分（glm-5.3 = 63,460.3：输入 2,966.3 + 缓存 58,308.7 + 输出 2,185.3）。
  - 边界说明：真实积分报告是**账号维度**（monitor 接口按登录账号记账），不区分本地 provider 分组；按 provider 的积分仍为本地估算（按官方系数，不含促销折扣）。monitor 数据仅 BigModel OAuth 登录用户可得，直连第三方 key 不涉及。
- **撤销按 key 分组与 `ZCODE_KEY_NAME`，统计维度回归 provider**（src/usage.ts、src/env-config.ts、test/usage.test.ts、test/env-config.test.ts、.env.example、README.md、README_cn.md、README_zh_tw.md、docs/CONFIGURATION.md）。
  - 为什么改：用户裁定「按 key 分组统计的功能撤销，不需要了，也不需要设置 key-name 了」——多 key 需求不再存在（真实积分已按账号维度从 monitor 接口拉取，key 级区分失去意义）。
  - 改了什么：① `.env` 变量表删除 `ZCODE_KEY_NAME`，`buildProviderConfig()` 的 provider 显示名缺省值回归 `displayName(providerId)`；config.json 不再写 `keyName:<providerId>` 标签（`usage.creditMultiplier` 保留）；② src/usage.ts 删除 key-name 三级回落（keyName 字段、usage 块标签读取），分组直接以 provider ID 展示（`ProviderStats`），报告标题与汇总行改为 "Model usage by provider" / "All providers"；③ 测试同步（删 key-name 用例、改 provider 断言）；④ 文档同步。全量 582 测试通过。
- **撤销促销倍率 `ZCODE_STATS_CREDIT_MULTIPLIER`：积分一律以 monitor 服务端真实数据为准**（src/usage.ts、src/env-config.ts、test/usage.test.ts、test/env-config.test.ts、.env.example、README.md、README_cn.md、README_zh_tw.md、docs/CONFIGURATION.md）。
  - 为什么改：用户裁定「不要自己算，我要的是官方后端的真实数据」——monitor 真实积分报告已包含全部促销与折扣，本地手工配倍率既多余又不准（0.67 只是近似换算）。
  - 改了什么：① `.env` 变量表删除 `ZCODE_STATS_CREDIT_MULTIPLIER`，env 同步不再写 config.json 的 `usage.creditMultiplier`（`parseCreditMultiplier()` 删除）；② `computeCredits()` 删除倍率参数、回归纯官方系数；`StatsTotals` 删 `creditMultiplier` 字段；报告标题与积分行不再显示促销倍率标注；③ 测试同步（删倍率用例）；④ 文档同步（.env.example 删「Usage stats」节、三版 README 与 CONFIGURATION.md 删倍率说明，真实积分表述提前）。
- **版本号 3.8.1-18 → 3.8.1-19**（VERSION、package.json、test/update.test.ts、CHANGELOG.md）：3.8.1-18 已发 GitHub Release（v3.8.1-18，2026-08-23）且其后有新提交（本次 `zcode stats` 用量统计提交 b590594），commit skill 版本滞后检测触发 patch 级 bump（沿用项目 `3.8.1-N` 后缀递增惯例）；版本号运行时从 package.json 读取、无构建产物需重建，update 测试断言同步改。

## 3.8.1-18

### 变更

- **欢迎横幅路径用户目录以 `~` 占位 + 品牌 Z 标志重绘为赛博朋克双层（与项目 LOGO 同风格）**（packages/zcode-tui/src/welcome-banner.ts、packages/zcode-tui/src/theme.ts、test/welcome-banner.test.ts）。
  - 为什么改：① 横幅显示的当前目录是完整绝对路径，`/Users/<用户名>/...` 把本机用户名亮在界面上（README 演示图脱敏时也特意把这类路径改成 `~/...` 占位），与 shell 提示符的 `~` 惯例不符；用户要求家目录前缀用 `~` 占位。② 横幅原有的 Z 标志是单色极简斜切 Z（Desktop 图标风格的终端化），与 3.8.1-17 重设计的赛博朋克 LOGO（青色 Z 主体 + 品红残影 + glitch 切片）风格脱节，用户要求两者一致。
  - 改了什么：① `displayWorkspace()`——用 `os.homedir()` 把工作区路径的家目录前缀折叠为 `~`（家目录本身显示 `~`、家外路径保持绝对路径不变；宽窄两种横幅模式都走此函数，截断逻辑不变、只是起点变短）；② 品牌 Z 标志改为双层结构——`BRAND_Z`（青色 accent 的切角 Z）+ `BRAND_GHOST`（品红 brandGhost 的错位残影，向下偏移一行、向右错位），渲染时逐列合并：Z 层非空画青、空处露出的 ghost 画品红，形成 LOGO 同款「色差故障」叠影；③ theme.ts 新增 `brandGhost` 主题色（dark 213 号品红 / light 170 号，对应 LOGO 的 #E879F9 残影）；④ 品牌标志宽度 10 → 12 列（容纳错位残影），`BRAND_MARK` 导出改为双层合并结果；⑤ 测试更新：Z 标志用例改为断言双层残影结构、新增 ghost 颜色（品红 ANSI 码）与 Z 颜色断言、新增 `~` 折叠用例（家内折叠 / 家目录本身 / 家外不折叠），48 列截断断言随 `~` 折叠后路径变短同步调整。`bun run build:tui` 重建 dist，全量 561 测试通过。


- **demo.svg 演示录屏文本脱敏：混合用户路径与 ls 用户名改为中性占位**（docs/assets/demo.svg）。
  - 为什么改：该 SVG 是上游原作者用 asciinema 录屏、svg-term 转换的动画，画面文本里录进了原作者本机的完整路径；本仓库 rebrand 时全局把用户名 `kingsword09` 替换成 `xhqing`，造成 `/Users/xhqing/Documents/code/ai/zcode-cli/...` 这种「一半是本人用户名、一半是原作者目录结构」的混合路径——既指向本机不存在的位置（有误导性），又把本人用户名与本机目录布局（`Documents/code/ai`）泄露在公开仓库的演示图里；`ls -la` 输出的属主列同样暴露用户名。
  - 改了什么：① 6 处完整路径 `/Users/xhqing/Documents/code/ai/zcode-cli/...` 统一改为中性占位 `~/zcode-cli/...`（等长不影响画面布局，且今后换机器 / 换用户名都不会过期）；② 约 10 处 `ls -la` 属主列 `xhqing staff` 改为 `nobody staff`（6 字符对 6 字符等长替换，列对齐不乱）；③ 欢迎横幅里一处砍头截断的路径 `…sword09/Documents/code/ai/zcode-cli`（用户名被截掉尾巴、当初全局替换没匹配到）同样改为 `~/zcode-cli`；④ 公开署名（package.json `作者: xhqing`）与仓库地址（`github.com/xhqing/zcode-cli`）属演示内容本身、非本机信息，保留不动。复扫确认：无 `/Users/`、`/home/`、`kingsword`、`Documents/code`、私有 IP、密钥类字样残留（画面中 `tokens` 命中均为 token 用量统计文本，非凭证）。

- **与原作者 npm 发布通道彻底切割：包名统一为 `zcode-cli`，GitHub Release 成为唯一分发渠道**（package.json、bun.lock、src/update.ts、src/update-check.ts、packages/zcode-tui/src/update-available-view.ts、scripts/pack-release.ts、scripts/smoke-package.ts、.github/workflows/publish.yml、.github/workflows/prepare-release.yml、test/update.test.ts、test/update-check.test.ts、test/release-package.test.ts、test/release-workflows.test.ts、README.md、README_cn.md、README_zh_tw.md、docs/RELEASING.md）。
  - 为什么改：本仓库是独立维护的项目分支，与原作者（kingsword09）的 npm 发布通道没有任何关系，只是当初拷贝代码走出自己的分支；但项目内仍残留大量指向原作者 npm 通道的配置与表述——npm 包名 `zcode-app-cli` 归原作者所有（npm 上 latest 3.8.1-15 是原作者构建的，内容与本地不同）、启动更新检查查的是原作者包的 npm registry、README 教用户 `npm install -g zcode-app-cli@latest`（装到的是原作者的包）、publish workflow 里还有整段 npm Trusted Publishing 流程。用户裁定这些全部清理。
  - 改了什么：① package.json / bun.lock 包名 `zcode-app-cli` → `zcode-cli`，安装路径 `node_modules/zcode-cli`；update.ts 的 `packageName` 常量同步、删除冗余 `displayName`（两者已同名）；smoke-package.ts 安装路径断言同步。② 启动更新检查（update-check.ts）从 npm registry 探测改为查 GitHub Releases latest API（`api.github.com/repos/xhqing/zcode-cli/releases/latest` 的 `tag_name`），TUI 更新提示与实际更新命令（`zcode --update`）从此指向同一发布源——此前 TUI 检查的是原作者 npm 包的版本，与本人 Release 版本号对不上。③ TUI 更新卡片删掉「(npm package: zcode-app-cli)」备注行。④ publish.yml 删除 npm publish / npm view / Trusted Publishing / id-token 权限与内联版本比较器，保留校验、tag 创建与 Release + tarball asset 上传；prepare-release.yml 删除 npm view 已发布 / latest 检查；release-workflows.test.ts 断言同步并新增「workflow 不得含 npm publish / npm view」防回归。⑤ 三版 README 安装命令改为 GitHub Release tarball URL（`https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-<版本>.tgz`，URL 已实测可下载）、更新检查表述改为 GitHub Release、清除全部 npm 通道表述；RELEASING.md 删除 npm 引导与 Trusted Publisher 配置章节，发布口径统一为「tag + GitHub Release + tarball asset」。⑥ 版本号 3.8.1-17 → 3.8.1-18。
  - 注意：npm 上 `zcode-app-cli` 仍归原作者，本改名不影响其已发布内容；已装旧版的用户 `zcode --update` 会正常拉取新 Release（该命令本就走 GitHub Release）。docs/assets/demo.svg 录屏文本与 `.claude/CLAUDE.md` 项目描述中的旧包名一并清理。

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
