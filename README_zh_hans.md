# ZCode CLI

<div align="center">

![ZCode CLI](./assets/logo.svg)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/Version-3.8.1--23-blue.svg)](./CHANGELOG.md)
[![Type](https://img.shields.io/badge/Type-CLI_Tool-blue.svg)]()

[English](README.md) | 简体中文 | [繁體中文](README_zh_hant.md)

</div>

非官方的 ZCode 终端客户端，直接运行 ZCode Desktop 附带的官方 agent runtime。

本项目提取上游 `resources/glm` runtime，注入基于
[`@earendil-works/pi-tui`](https://github.com/earendil-works/pi/tree/main/packages/tui)
的本地 `@zcode/tui` 实现，并以 Node.js 子进程直接继承用户终端的方式启动。

本项目与 Z.ai 无隶属关系、也未获其背书。ZCode 及其附带的 runtime 仍受上游条款约束；
发布前请先确认你有权再分发提取出的 runtime。

![ZCode CLI TUI demo](./docs/assets/demo.svg)

## 快速开始

```bash
npm install -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-23.tgz
zcode
```

首次启动时，ZCode 会创建 `~/.zcode/cli/config.json`（Windows 上为
`%USERPROFILE%\.zcode\cli\config.json`），写入免凭证的默认配置，并在 TUI 中打开
设置向导。向导会依次引导[配置](./docs/CONFIGURATION.md)中介绍的三种模型接入方式；
若本机装有 ZCode 桌面版，还可导入桌面版的 provider 配置（凭证仍需重新登录，类似
浏览器导入用户资料）。随时可用 `/setup` 重新打开向导；按 Esc 跳过。

## 目录

- [快速开始](#快速开始)
- [安装与更新](#安装与更新)
- [用量统计](#用量统计)
- [架构](#架构)
- [功能特性](#功能特性)
- [工作区集成](#工作区集成)
- [插件管理](#插件管理)
- [环境要求](#环境要求)
- [配置](#配置)
- [本地开发](#本地开发)
- [参与贡献](#参与贡献)
- [版权与署名](#版权与署名)

## 安装与更新

```bash
npm install -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-23.tgz
# 或
bun add -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-23.tgz
```

GitHub Release 是唯一的分发渠道，本项目不发布到 npm。包装名为
`zcode-cli`，命令为 `zcode`。

已安装的用户升级只需执行：

```bash
zcode --update
```

该命令经 `gh` CLI 从 GitHub Release 解析最新版本，下载 Release 上挂的
`zcode-cli-<版本>.tgz` asset 后全局重装。GitHub Release 是唯一的更新
渠道——每个 Release 都附带该 tarball asset。

交互式启动时，每 20 小时至多检查一次 GitHub Release 最新版（按已安装版本计），
有新版本时以非阻塞的更新卡片提示，附精确的更新命令与 release notes 链接。CI 环境
自动跳过检查。设置 `ZCODE_DISABLE_UPDATE_CHECK=1` 或 `NO_UPDATE_NOTIFIER=1`
可关闭。

正常安装只需 Node.js，无原生 PTY 扩展、无 postinstall 构建步骤。

## 用量统计

```bash
zcode stats          # 人类可读报告
zcode stats --json   # 机器可读 JSON
```

ZCode runtime 会把每次模型请求记录到本地 SQLite 数据库
（`~/.zcode/cli/db/db.sqlite`）。`zcode stats` 按 **provider**（即
`~/.zcode/cli/config.json` 里的每个 provider 条目）聚合历史用量，API key
脱敏为前 4 位与后 4 位。每段列出请求数与错误数、**输入 token、缓存命中
token 与命中率、输出 token**，并按官方 GLM Coding Plan 系数（积分 = token ×
系数 ÷ 10000，非高峰时段 5 折）估算**分输入 / 缓存 / 输出三项的积分消耗**；
无公开系数表的模型跳过并标注。末行汇总全部 provider。

zcode-cli 的模型请求由官方 ZCode runtime 发出（请求头带
`User-Agent: ZCode/<版本>`），官方针对 ZCode 的促销优惠同样适用。本机存有
`zcode login` 登录的 BigModel OAuth 凭据时，`zcode stats` 会调用厂商 monitor
接口（与 ZCode Desktop 用量页同源），追加一份**服务端真实积分报告**——按模型
列出实际抵扣积分（已含促销与非高峰折扣），并分输入 / 缓存 / 输出三桶。无凭据
或请求失败时省略该段、仅保留本地估算。

## 登录身份

```bash
zcode identity              # 查看活跃 provider 的登录身份
zcode identity set <名称>   # 手动同步本地登录显示名
zcode identity clear        # 删除快照，回落显示脱敏 API key
```

TUI 横幅与状态栏显示的登录账号名来自共享凭证库
（`~/.zcode/v2/credentials.json`）里加密的 `oauth:<provider>:user_info`
**快照**。该快照只在 OAuth 登录那一刻写入，此后没有任何机制刷新它——在
bigmodel.cn 上改了用户名后 TUI 会一直显示旧名，重新 `zcode login` 也无济于事
（runtime 只保存换发的 API key，不回写用户信息快照）。
`zcode identity set` 就是手动同步入口：重写快照中的 username /
displayName（保留 id / 头像等其余字段与凭证库相邻条目），新开的 TUI 会话
立即生效。

切换账号由两层机制自动处理：

- TUI 横幅与状态栏在每次登录后都会重新读取身份——切换 Z.AI 账号后无需
  重启 TUI 即显示新名（Z.AI OAuth 登录流程本身会重写快照）。
- BigModel OAuth 与 API key 登录从不回写快照，这类登录之后存储的账号名
  无法再归因到当前登录账号。当登录使 provider 的 API key 发生变化时，
  TUI 自动清除旧名、回落显示脱敏 API key（同账号重新登录则保留原名）；
  之后可用 `zcode identity set <名称>` 重新固定当前账号的显示名。

## 架构

```text
Node.js 启动器（配置 / 登录 / 版本元数据）
  └─ 继承的 stdin / stdout / stderr
      └─ 官方 zcode.cjs agent runtime
          └─ 本地 @zcode/tui 适配层
              └─ @earendil-works/pi-tui
```

官方的 agent、模型、会话、工具、插件、MCP、凭证存储与 provider 配置逻辑全部保留
在提取出的 runtime 中。本地包只补齐缺失的终端界面，以及为 Z.AI 注册的桌面 OAuth
流程提供一条窄的 macOS 回调桥。Node.js 启动公开的命令，并作为提取出的上游
内核的兼容宿主。官方 runtime 直接掌管原始终端模式、输入法光标定位与缩放处理；
启动器不插入第二个 PTY、不中转终端字节流。

## 功能特性

**编辑与输入。** 基于 pi-tui 的差分渲染，支持中日韩宽字符的多行编辑器；斜杠命令、
统一的 `@` 工作区 / 插件引用与 `$` Skill 补全；经 ZCode 历史接口持久化的输入历史；
支持 `--no-color` 与 `NO_COLOR`。

**流式输出与会话。** 来自官方 ZCode 会话事件的流式助手文本；`/mode`、`/model`、
`/resume`、`/plugins` 等上游斜杠命令；可搜索的模型与推理力度选择器，以及 MCP 与
工作流面板；状态栏 Shift+Tab 模式循环（`build` → `edit` → `yolo` → `plan`）、
Ctrl+N 切换模型、空输入 Tab 切换推理力度；回合脚注右侧的结构化会话目标状态；
带动画的活动回合计时器（`ZCODE_TUI_REDUCED_MOTION=1` 时退化为静态）；响应式的
剩余上下文与会话 token 指标。

**登录与权限。** `/login` 设置选项与掩码 API key 输入；脱敏的会话记录与历史；
OAuth 等待态；挂起的 Z.AI 浏览器登录（含终端恢复与可选的 `ZCODE_TUI_LOGIN_CMD`
覆盖）；启动横幅与状态栏显示登录身份（OAuth 账号用户名或脱敏 API key）；
交互式工具权限审批对话框。

**附件与富输出。** Ctrl+V 智能粘贴剪贴板（图片加为附件、文本直接插入编
辑器），`/paste-image` 专贴图片，配键盘可选的附件行；紧凑的工具执行视图（路径、命令、进度、结果与图片预览）；父子 Agent 工具树
（含可恢复的子代理元数据、可展开的 Prompt/Response 详情）；语法高亮的 Markdown
代码块与流式期间稳定的块渲染；Pierre 风格的内联 diff（行号、语法高亮、词级变更、
CJK 换行）；终端原生 Mermaid 预览（不支持或超大的图表回退为源码展示）。

**检视与导航。** `/diff` 浏览当前 Git 变更与逐回合文件变更；`/context` 查看
prompt 组成、缓存与上下文用量；`/status` 查看会话、runtime、目标、MCP 与工作区
详情；`/activity` 与任务中心（后台状态、输出、agent 会话与恢复）；可搜索的会话
记录导航（逐块展开、选中块复制、`n`/`N` 匹配遍历）；transcript 与编辑器之间
持久化的活动工具、后台任务与打开的计划。

**转向、回退与通知。** 活动回合转向、取消与错误上报；双 Esc 回退（输入点选择与
安全的会话 / 工作区作用域）；失焦时的回合完成通知（终端原生 OSC 9 或 BEL，可选
桌面命令）；`/copy`、`/cls`、`/exit`、Ctrl+C 与 Ctrl+D 处理，退出时显示 token
用量与恢复指引。

## 工作区集成

### 引用工作区文件

在提示词开头或空白后输入 `@` 打开项目文件补全。继续输入路径，用上下键选择候选，
按 Tab 或 Enter 插入。选中目录后可继续输入下一段路径。

```text
Explain @README.md
Compare @src/index.ts with @"docs/design notes.md"
```

候选来自官方 ZCode runtime，限定在当前工作区内，并排除常见的仓库元数据与依赖
目录。含空格的路径以 `@"..."` 引号形式插入。

### 引用插件

同一个 `@` 选择器还包含已启用、无歧义且至少暴露一个 Skill、已连接 MCP 服务器或
Subagent 的插件。插件行以 `@name` 标注其来源市场。选中后插入 runtime 原生的
Markdown 引用：

```text
Use [@browser-use](plugin://browser-use@zcode-plugins-official) to check this page
```

终端编辑器显示的是 Markdown 源码，因为没有桌面版式的内嵌 chip。runtime 会在当前
会话上解析该链接，只把该插件的在线能力加为元数据。插件引用不会安装、启用、授权
或强制使用任何能力。已禁用、歧义或过期的引用会被 runtime 忽略。

### 调用 Skill

在提示词开头或空白后输入 `$` 打开 Skill 选择器。继续输入名称，用上下键选择，按
Tab 或 Enter 插入。

```text
$audit review the current changes
Use $browser-use:control-browser to verify the page
```

选择器使用官方 runtime 的 Skill 目录，插件 Skill 以限定名插入。提交时，精确匹配
的 `$name` 会被转换为请求，在执行可见的用户请求前先经 runtime 的 `Skill` 工具
加载所选 Skill。未知的 `$` 标记保持普通提示词文本。

当整个插件相关（含其 MCP 服务器或 Subagent）时用 `@plugin`；当必须在任务开始前
加载某个确切 Skill 时用 `$plugin:skill`。

Skill 与自定义命令的发现也可在 TUI 之外通过 runtime 子命令完成，`--json` 供
脚本使用：

```bash
zcode skills list                 # 所有已发现的 skill（含插件限定名）
zcode skills inspect <name>       # 完整描述、来源路径与元数据
zcode commands list               # 已发现的自定义斜杠命令
zcode commands inspect <name>     # 参数提示与解析后的正文
```

### 活动回合输入

常规 agent 回合运行期间，按 Enter 将当前文本作为同回合转向发送。在官方 runtime
到达安全的模型步边界之前，转向停留在编辑器旁的等待行，不显示为已提交的会话历史。
runtime 确认注入后，消息按其实际位置进入会话记录，并使用正常的用户消息 `›`
前缀。`↪` 标记专属于临时等待行。

若想让后续输入保持可编辑，请在编辑器含文本且补全关闭时按 Tab。输入进入本地下一
回合队列，按 FIFO 顺序在活动回合正常结束后发出。编辑器为空时按 `Alt+Up` 或
`Shift-Left` 可把最近排队的输入移回编辑器。已接受的转向无法编辑——即使在等待行
仍可见时，它已交给官方 runtime；需要保持可改时请用 Tab。被拒绝或在注入前丢弃的
转向会回到可编辑的下一回合队列。

### 图片附件

按 `Ctrl+V` 从剪贴板粘贴：内容是图片则加为附件，是文本则直接插入编辑
器。运行 `/paste-image` 则只附加图片。待发图片以完整的 `[Image #N]`
标记显示在编辑器上方。提交提示词时，这些图片立即移入该用户回合，从待发行移除，
不会泄漏到下一个提示词。

将编辑器光标移到首行行首按 `Up`，或运行 `/attachments`，可聚焦附件行。聚焦时：

- `Left`/`Right` 选择图片；
- `Backspace` 或 `Delete` 删除选中图片并重新编号；
- `Down`、`Esc`、`Ctrl+C` 或 `Enter` 返回编辑器且不改动其文本。

运行 `/attachments clear` 一次性移除所有待发图片。`Ctrl+D` 保留终端标准的
空编辑器退出与前向删除行为。

### 会话回退

编辑器为空且无活动回合时，在 800 ms 内按两次 `Esc` 打开会话回退选择器。选择要
返回的用户输入，查看可用的工作区检查点，然后在可用作用域中选择：

- **仅会话**：移除之后的会话回合，工作区文件保持不变，并把选中的输入恢复到编辑器；
- **会话与工作区**：同时恢复安全检查点内的文件变更；
- **仅工作区**：只恢复安全检查点内的文件，不改动会话。

只有当官方 ZCode runtime 报告完整的安全检查点计划时，作用域选择器才提供工作区
恢复选项。外部修改的文件不会被覆盖；Bash 或终端文件变更因没有可恢复的 ZCode
检查点而报告为忽略。在作用域选择器按 `Esc` 返回输入选择，再按 `Esc` 关闭回退。

### TUI 检视与导航

```text
/diff                         浏览当前与逐回合的文件变更
/context                      检视上下文用量与来源组成
/status                       检视详细的 runtime 与会话状态
/activity                     检视所有活动工具与打开的任务
/tasks                        检视并管理后台任务
/tasks message <id> <text>    向运行中的后台 agent 发送指引
/tasks resume <id> [text]     恢复已停止或失败的后台 agent
/tasks stop <id>              停止运行中的后台任务
/search <text>                搜索保留的会话记录块
/search next|prev|clear       导航或关闭会话记录搜索
/transcript latest            选中最新的会话记录块
/transcript next|prev|close   导航或离开会话记录选择
/copy                         复制选中块或最新回复
/cls                          仅清空可见会话记录
```

`/cls` 只清空 TUI 显示、不触碰会话。runtime 自带的 `/clear` 是 `/new` 的别名、
会开启新会话，因此原样转发给 runtime。

任务中心把自主任务的输出留在前台会话之外。主会话只收到紧凑的完成、回复与失败
通知；选中任务可查看其输出与任务范围的活动。Agent 任务运行期间可接收消息，官方
runtime 收到消息时会从保存的子会话恢复终端 agent。Bash 任务提供可审查的重跑请求，
因为停止的进程无法从执行检查点继续。保存的最终任务输出在 TUI 重启后仍可用，大
文件截断保留最新 64 KiB。工作流任务打开其现有运行面板与控制。

一秒内完成的 Agent 调用保持为普通前台工具，结果可直接进入当前回复。更长的
Agent 调用自动移入任务中心，释放前台回合、继续后台运行。可将 `subagents.autoBackgroundMs`
设为其它正时长，或设为 `0` 禁用自动后台化。显式的 `run_in_background: true`
仍会立即后台化 Agent。

编辑器为空时，`Alt+Up` 与 `Alt-Down` 导航选中的会话记录块。`Ctrl+O` 仅展开
选中 / 搜索命中的块；无选中时切换所有可展开内容。会话记录搜索期间，`n` 与 `N`
移动到下一个 / 上一个匹配。`Left`/`Right`（或 `PageUp` 与 `PageDown`）对超大的
选中块分页，不必一次渲染整条消息。`Esc` 退出搜索或会话记录导航。

## 插件管理

内置插件（Browser Use、文档 skills、Skill Creator 等）由官方 runtime 播种。
既有已装插件命令继续直接使用 runtime：

```bash
zcode plugins list --json
zcode plugins enable <plugin-id>
zcode plugins disable <plugin-id>
zcode plugins uninstall <plugin-id> --force
```

Node.js 启动器通过调用 runtime 公开的 `app-server` 协议补充市场操作；不 patch、不
重新实现插件子系统。运行 `zcode plugins --help` 查看完整命令列表。典型的第三方
安装流程：

```bash
zcode plugins discover
zcode plugins marketplace add owner/repository --dry-run
zcode plugins marketplace add owner/repository
zcode plugins describe plugin-name@marketplace-name
zcode plugins install plugin-name@marketplace-name --dry-run
zcode plugins install plugin-name@marketplace-name
```

市场添加与安装会先校验、展示插件的组件与依赖闭包并请求确认。`--yes` 仅用于有意的
非交互执行，`--json` 输出结构化数据，`--scope user|workspace` 选择安装范围。代理
后的市场 Git 访问使用 `ZCODE_HTTP_PROXY`。

带配置的插件可从 JSON 文件加载选项，避免在进程参数列表中暴露取值：

```bash
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json --dry-run
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json
```

含密钥的文件请保密。安装、更新、配置、启用与禁用的变更对新会话生效。

### CLI 中的 Browser Use

启动器默认为 TUI、`--prompt`、`--print` 与 `--target` 会话启用 CLI 托管的无头
Chromium 后端。这使得已启用的 `browser-use` 插件无需额外启动参数即可在常规
`zcode` 命令中使用：

```bash
zcode
zcode --prompt \
  'Use $browser-use:control-browser to inspect https://example.com'
```

显式的 `--browser-use=headless` 形式仍受支持，包括需要手动指定 Chromium 时的
`--browser-executable <path>`。托管后端仍需可用的本地 Chrome/Chromium 可执行
文件；自动发现失败时，请用 `--browser-executable` 传入绝对路径。启动器绝不会向
`plugins`、`skills`、`doctor`、`app-server` 等管理命令注入 Browser Use。既有
会话须重启后该后端才可用。

托管浏览器是一次性的无头上下文。它不复用 ZCode 桌面版内置浏览器的用户资料、
cookie 或登录态，因此公共搜索引擎可能更频繁地断开连接或要求验证，在 VPN、代理或
共享出口 IP 下尤甚。`--browser-executable` 只选择 Chrome/Chromium 二进制，不会
让浏览器变有头或持久化。一般事实查证时，若有搜索能力可用，避免强制使用
Browser Use；尽量使用直达页面 URL，交互式登录或验证流程请用桌面版内置浏览器。

## 环境要求

- Node.js 22.19 或更高；
- macOS、Linux 或 Windows（x64 与 ARM64）。

Z.AI 浏览器 OAuth 目前仅支持 macOS，因为注册的 provider 回调是
`zcode://zai-auth/callback`；API key 与自定义 provider 接入在所有受支持平台上
均可用。

当理想的 Node.js 可执行文件不在 `PATH` 上时，设置 `ZCODE_NODE=/absolute/path/to/node`。

## 配置

ZCode 从 `~/.zcode/cli/config.json`（Windows 上为
`%USERPROFILE%\.zcode\cli\config.json`）读取配置，工作目录下的 `zcode.json` 或
`.zcode/config.json` 可做项目级覆盖。既有文件不会被替换。

支持三种模型接入方式：Z.AI OAuth（仅 macOS）、Z.AI/BigModel Coding Plan
API key、或带自定义 provider 的直连 API key。详细的设置步骤、重试 / 超时、主题
与回合完成通知见[配置文档](./docs/CONFIGURATION.md)。

另有扁平文件方式：把带注释的 `.env.example` 模板复制为 `~/.zcode/cli/.env`
并填入 API key 与模型 ID——每次启动时 zcode 会先把它同步进 config.json 再拉起
runtime，无需登录或手改 JSON。备用 key 用编号变量（`ZCODE_API_KEY_2`、
`ZCODE_API_KEY_3`……每变量一把 key）：多于一把时 zcode 会启用本地回环容灾代理，
某把 key 的请求被拒（401/403/429、5xx、连接失败）时自动换下一把重试，详见
[配置文档](./docs/CONFIGURATION.md)。

## 本地开发

安装依赖并从本地 ZCode Desktop 安装实时同步 TypeScript 启动客户端：

```bash
bun install
bun run dev
```

运行全部验证层：

```bash
bun run typecheck
bun test
bun run check
bun run check:tui
```

OAuth 接入、发布工作流细节、CI 与完整开发指南见[开发文档](./docs/DEVELOPMENT.md)；
仅供维护者使用的发布与发布流程见[发布文档](./docs/RELEASING.md)。

## 参与贡献

欢迎在 [github.com/xhqing/zcode-cli](https://github.com/xhqing/zcode-cli) 提交
issue 与 pull request。较大改动请先开 issue 讨论。本地环境搭建与验证命令见
[开发文档](./docs/DEVELOPMENT.md)，发布流程见[发布文档](./docs/RELEASING.md)。

## 版权与署名

本项目以 [MIT 许可证](./LICENSE.md) 发布。

- 版权所有 (c) 2026 zcode-app-cli contributors（上游项目）。
- 版权所有 (c) 2026 All Contributors。
- 署名方式：复用或再分发本项目时，请保留版权声明与许可证文本，并以链接回项目仓库的方式注明来源。
- 项目地址：https://github.com/xhqing/zcode-cli
