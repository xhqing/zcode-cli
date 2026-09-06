# Changelog

本项目所有值得注意的变更都记录在此文件中。

## 3.8.1-32 - 2026-09-06

### 新增（回归防护网补缺：6 个测试文件 46 条用例 + 1 个缺陷锁定）

- **补齐「源码有、测试无」的六个真实覆盖缺口**（test/tool-group-view.test.ts、test/command.test.ts、test/protocol-part-view.test.ts、test/renderable.test.ts、test/plugin-protocol.test.ts、test/clipboard-text.test.ts，由 Hopper（TestEngineerAgent）按回归防护职责补写；版本号 bump 留待发版流程统一处理）。
  - 为什么改：用户要求为 zcode-cli 织回归防护网、防止新功能改坏已有功能。全量源码 ↔ 测试映射摸底发现：80 个既有测试已覆盖绝大多数模块（含经其它测试文件间接覆盖的 bigmodel-users / color-scheme / update-available-view / login-flow 导出函数），但六个模块零直接测试——tool-group-view（工具分组折叠摘要，TUI 高频视觉路径）、command（captureCommand 子进程捕获，zai-oauth / darwin-oauth-callback / update 三处依赖的基础工具）、protocol-part-view（五类协议 part 渲染，仅被 registry 测试顺带 import）、renderable（三个组件类型守卫）、plugin-protocol（插件方法名协议契约表）、clipboard-text（Ctrl+V 智能粘贴，3.8.1-23 新增功能）。
  - 改了什么：六个新测试文件共 46 条用例，全部锁定当前行为契约——tool-group-view 10 条（成员增删、展开传播、隐藏内容、搜索文本拼接、折叠摘要的单复数 / read-search 分组 / 进行中失败中断的图标优先级、展开时空行分隔）；command 5 条（stdout/stderr 分离捕获、非零退出码、多行输出、启动失败契约）；protocol-part-view 14 条（可见性过滤、file 的 url 藏于展开态、retry/compaction/subagent/agent 渲染、搜索文本、update() 换装）；renderable 6 条（三守卫正反分支）；plugin-protocol 4 条（11 个方法名逐字锁定 + workspace 路径归一）；clipboard-text 2 条（跨平台返回契约 + darwin pbpaste 专项，linux CI 无剪贴板工具走 undefined 路径）。
  - 缺陷发现（先红后绿纪律，未修实现——修复归开发侧，已记 TODO T5）：command.test.ts 一条用例以 `test.failing` 锁定——captureCommand 在目标二进制不存在时设计意图是返回 `{ code: 1, stderr: 启动错误 }`，实测抛 `ERR_STREAM_PREMATURE_CLOSE`（error 事件后子进程流提前关闭，readText 的异步迭代先于 Promise.all reject）；影响 update（用户未装 gh）与 zai-oauth 打开浏览器的降级路径。修复后去掉 .failing 标记即可，若实现先达标 bun 会反向报错提醒。
  - 验证：全量 `bun test` 746 pass / 0 fail（84 files，含新增 6 文件 46 条）；`tsc --noEmit` 通过。
  - 配套治理（2026-09-06 同日，Hopper 配置）：main 分支保护已启用——required status check `validate`（strict）、Require pull request before merging（0 approvals，单人可自合并）、enforce_admins、禁 force push、禁删分支。此后所有改动必须走 feature 分支 + PR、CI 绿灯才能进 main，直接 push main 会被拒绝（按 GitHub 官方文档语义：required checks 拦未验证 commit、Require PR 完全禁直接 push）。注意：本仓库是 fork（上游 kingsword09/zcode-cli），GitHub 对 fork 的 workflow 默认不随 push 自动运行——首次走 PR 前先在 Actions 页签确认 workflows 已启用，否则 PR 会等不到 `validate` 检查。

### 修复

- **未登录时 `/model` 列表选官方条目（如 `bigmodel/glm-5.3`）完全不能用：模型切换现在把无凭证的官方槽位引用解析到同 provider 的 env 槽（custom-provider）**（src/identity.ts、packages/zcode-tui/src/selectors.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts、test/selectors.test.ts，版本号 bump 至 3.8.1-32：VERSION、package.json、test/update.test.ts、三版 README 徽章与安装 URL）。
  - 为什么改：用户报告 3.8.1-31 的列表去重有 bug——`env-` 前缀条目被剔除后，未登录（无 vault 登录、官方槽无 key）时选中官方条目 `bigmodel/glm-5.3` 完全不能用，而它已是该模型在列表里的唯一路径；用户要求列表里剩下的所有模型选项不管登录与否都能用、未登录走 custom-provider 逻辑。根因：去重保留官方条目、删掉 env 槽条目，但官方 `bigmodel` 槽位归 `/login` 管、未登录时没有凭证，`setModel("bigmodel/glm-5.3")` 发给 runtime 后无 key 可用；真正带 key 的 `env-bigmodel` 槽位条目恰好被去重删掉了。
  - 改了什么：① src/identity.ts 新增 `resolveModelSlotRef()`：官方槽引用（`<provider>/<model>`）在该 provider 有 vault 登录或官方槽 key 时原样返回；两者皆无而 `env-<provider>` 槽位带 key 且声明了该模型时回退为 env 槽引用（按 provider 独立判定——登录 zai 不影响选 bigmodel 模型时的回退）；已是 env 槽引用、env 槽未声明该模型或无带 key 的 env 槽则原样返回。② TUI 三个模型切换入口——`/model` 选择列表与快捷循环切换共用的 `switchTransientModel`（手输 `/model <provider/model>` 也汇入此处）、`/settings → Model providers` 保存后的会话应用——发桥前一律过 `resolveModelSlotRef()`；`/settings` 持久化写进 config.json 的 main/lite 同样写解析后的槽位引用，未登录时保存的块直接指向可用的 env 槽（登录后的 `switchModelBlockToOfficialProvider` 迁移语义不变）。③ selectors.ts 的 current 标注改为双形式匹配（内部槽位形式 `env-<provider>/<model>` 与显示形式 `<provider>/<model>`），修复去重后 config 保存值（env 槽形式）与列表条目（官方形式）对不上导致「current」标记与 `/settings` 预选丢失的显示回归（3.8.1-31 引入）；`/settings` 的 main/lite 预选查找同步双形式匹配。
  - 溯源与防回归评估：3.8.1-31 的去重方向（每个模型只显示一次、官方条目胜出）保持不变——修复不动 `withoutEnvSlotTwins()` 的取舍，只把「未登录时 env 槽是唯一可用路径」的事实从显示层（保留 env 独有条目）补到切换层（官方条目在运行时解析回 env 槽）；env 独有条目（无官方孪生）原样保留、原样可用；登录态（vault token 或官方槽 key）行为与 3.8.1-31 完全一致（原样走官方槽）；3.8.1-26 的「未登录时 env 文件是 model block 权威」语义不受影响——`/settings` 未登录保存写 env 槽引用，与 launcher 启动同步写的方向一致。
  - 验证：`tsc --noEmit` 通过；identity 单测新增 7 用例（未登录回退、env 槽未声明该模型原样、无带 key env 槽原样、官方槽 key 原样、vault token 原样、跨 provider 独立判定、env 引用与无斜杠别名原样），selectors 单测新增 2 用例（current 标注以 env 槽形式匹配官方孪生：flat picker 与 provider 级联）；全量 `bun test` 746 pass / 0 fail（84 files）；TUI 冒烟 5 项全过（`build:tui` 重建后 vendor 内 `@zcode/tui` 副本按 `installLocalTui` 同步骤手动同步）。

## 3.8.1-31 - 2026-09-06

### 变更

- **`/model` 模型选择列表去重：同一 provider 的 env 槽条目（`env-<provider>/<model>`）在官方无前缀条目（`<provider>/<model>`）同时存在时不再显示**（packages/zcode-tui/src/selectors.ts、test/selectors.test.ts，版本号 bump 至 3.8.1-31：VERSION、package.json、test/update.test.ts、三版 README 徽章与安装 URL）。
  - 为什么改：用户报告（附截图）`/model` 列表出现六个选项，其中 `env-bigmodel/glm-5.3`、`env-bigmodel/glm-5-turbo`、`env-bigmodel/glm-5.3-flash` 三个带 env 前缀的条目与 `bigmodel/glm-5.3` 等三个无前缀条目指向同一批模型，用户裁定前缀版多余、不需要存在。根因：用户同时持有官方 `bigmodel` 槽位登录（API key）与 custom-provider.env 配置的同名 provider——launcher 把后者写进 config.json 的 `env-bigmodel` 槽，上游 runtime 的 `listModels()` 把两个槽位的模型都列出来，选择列表里每个模型出现两次。
  - 改了什么：selectors.ts 新增 `officialTwinId()`（算出 env 槽条目对应的无前缀孪生 id）与 `withoutEnvSlotTwins()`（官方孪生在列表内时剔除 env 槽条目，无孪生的 env 独有条目保留——未登录、仅 custom-provider 接入时它是唯一可选路径），`modelPicker()`（`/model` 列表与快捷循环切换共用）与 `providerModelPicker()`（`/settings → Model providers` 级联）都过这层过滤；级联里 env 槽组的模型被全部剔除后整组消失。config.json 的双槽结构、登录 / 登出流转（`switchModelBlockToOfficialProvider` 等）与 runtime 行为均不动。
  - 溯源与防回归评估：3.8.1-26 起的 `displayProviderId()` / `displayModelRef()` 只影响「当前模型名显示」（状态栏、横幅），`/model` 列表条目此前仍用原始 id——本次把同一「env- 前缀是配置管线、不该给用户看」的原则延伸到选择列表，方向一致非回归；env 独有条目（无官方孪生）保留，未登录 custom-provider 用户的 `/model` 列表不受影响（单测有用例钉住）；`modelPicker` 原有同 id 去重、`providerModelPicker` 组内去重语义不变，只是先去重再过滤孪生。
  - 验证：`tsc --noEmit` 通过；selectors 单测新增三用例（双槽并存剔除 env 条目且 current 标记落在官方条目、env 独有条目保留、级联全遮蔽时 env 组消失）；全量 `bun test` 696 pass / 0 fail（78 files）；TUI 冒烟 5 项全过（`build:tui` 重建后 vendor 内 `@zcode/tui` 副本按 `installLocalTui` 同步骤手动同步）。

## 3.8.1-30 - 2026-09-06

### 变更

- **TUI 状态栏模型名不再兜底显示「default」：启动即解析配置里的 `<provider>/<model_id>` 完整形式**（packages/zcode-tui/src/index.ts、src/model-access.ts、test/model-access.test.ts、scripts/smoke-tui.ts，版本号 bump 至 3.8.1-30：VERSION、package.json、test/update.test.ts、三版 README 徽章与安装 URL）。
  - 为什么改：用户报告（附截图）执行 zcode 进入 TUI 后底部状态栏显示 `◇ default — ◉ yolo — …`，要求模型名必须显示 `<provider>/<model_id>`。根因：官方 runtime 的登录门只检查官方 `zai`/`bigmodel` 槽位，模型访问配在 env 文件槽（`env-<id>`，custom-provider.env）的启动会被判 loginRequired、不带任何启动模型元数据；TUI 构造函数对缺失的 initialModel 兜底为字面量 "default"，而 `run()` 启动序列没有读 config 的兜底——`handleResult` 里既有的 `readConfiguredModelAccess()` 兜底要等第一条消息提交后才触发，首屏到发消息前一直显示 "default"。
  - 改了什么：① TUI `run()` 启动序列新增 `resolveStartupModel()`（在首帧绘制前 await 完成）：`this.model` 为 "default"（启动元数据缺失的标志）时先读 `readConfiguredModelAccess()`——命中（model.main 指向的槽位声明了该模型且带 key）则回填 `displayModelRef(access.model)` 显示并按既有语义把 loginRequired 修正为 false（与 `handleResult` / `handleLocalLogin` 的复核语义一致）；未命中则退到新增的 `readConfiguredMainModel()`（src/model-access.ts，只读 `config.json` 的 `model.main`、不要求槽位有 key）——未配置访问的 loginRequired 启动也显示配置选定的模型（如默认 `zai/glm-5.2`）而非 "default"；② 显示经 `displayModelRef()` 统一剥掉 `env-` 前缀：env 槽 `env-bigmodel/glm-5.3` 显示为 `bigmodel/glm-5.3`；③ 冒烟测试（scripts/smoke-tui.ts）：主流程新增「登录前（pristine HOME、无 key）footer 已显示 `◈ zai/glm-5.2`」断言（覆盖 main 兜底路径），新增 `verifyEnvSlotModelDisplay()` 独立段落（预写 env- 槽 + key + model.main 的 config 复刻用户场景，断言 footer 显示 `bigmodel/glm-5.3` 且全程无 `◈ default`，覆盖 access 命中路径），`/mode plan` 断言的宽松兜底分支 `◈ default` 收紧为具体模型形式防回归掩盖；④ model-access 单测新增 `readConfiguredMainModel` 两用例（无 key 也能读到 main；缺失 / 空白 / 不可读 JSON 返回 null）。
  - 溯源与防回归评估：3.8.1-25 为 loginRequired 建立的「env 槽已配置访问就不按未配置处理」复核语义（3.8.1-28 移除警告、复核语义保留在 `handleResult`）本次只是把同一复核从「发消息后」提前到「启动时」，属补齐而非弱化；3.8.1-27 的身份口径（env- 槽访问是「未登录」，banner 身份只认官方槽 / OAuth）不动——env 槽场景 banner 仍显示「Not signed in」、状态栏模型正常显示，两者并行不矛盾（登录身份与模型可用性是两件事）；`handleResult` 既有兜底与 `modelLabel()` 行为不变，正常登录启动（官方槽 / OAuth）仍由 runtime 元数据直达、不经新路径。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 693 pass / 0 fail（78 files）；TUI 冒烟 5 项全过（smoke-tui 含上述两处新断言与 env-slot 段、features / clear / pressure / widths 无回归）；`build:tui` 重建后 vendor 内 `@zcode/tui` 副本按 `installLocalTui` 同步骤手动同步（runtime 本体无变更）。

## 3.8.1-29 - 2026-09-06

### 变更

- **欢迎横幅默认显示登录状态：任何启动状态下横幅都有一行身份状态行，不再留白**（packages/zcode-tui/src/index.ts、packages/zcode-tui/src/login-identity.ts、packages/zcode-tui/src/welcome-banner.ts、test/welcome-banner.test.ts、scripts/smoke-tui.ts，版本号 bump 至 3.8.1-29：VERSION、package.json、test/update.test.ts、三版 README 徽章与安装 URL）。
  - 为什么改：用户报告执行 zcode 后的欢迎横幅没有任何登录状态信息，看不出当前是 Signed in 还是 Not signed in。已登录（OAuth / key）与 custom-provider 场景本就有身份行（3.8.1-26 / 27 建立的体系），唯独「未配置模型访问」的 loginRequired 启动是空白——该状态下身份被硬置为 undefined，横幅不渲染身份行；3.8.1-28 移除常驻警告前还有两行警告覆盖此状态，移除后彻底留白。
  - 改了什么：TUI 新增 `readBannerIdentity()`——`loginRequired=true`（runtime 跳过模型加载的未登录启动）或身份快照读取失败 / 返回 undefined（完全未配置）时，兜底为 `signedOut` 身份，横幅显示「Not signed in」；启动首绘（`run()`）与登录态刷新（`refreshLoginIdentity()`）两处统一走它。状态栏 metadata 行为不变（`signedOut` 依旧不输出 user / key 字段）；快照函数 `readLoginIdentitySnapshot()` 及其 undefined 语义不动（`zcode identity` 等其它调用方不受影响，undefined 只在 TUI 横幅这一层兜底）。
  - 溯源与防回归评估：3.8.1-28 用户裁定移除的是「引导性警告文案」（Model access is not configured. / Run /login...），本改动加的是「事实状态行」（Not signed in / Signed in as ... / API key ...）——性质不同，且本次为用户明确要求（「请加上默认登录状态信息」），不构成回归；3.8.1-26 / 27 的身份优先级（OAuth 账号名 > key 映射名 > 脱敏 key > signedOut）完全不变，仅补齐 undefined 场景的显示兜底。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 691 pass / 0 fail（78 files；welcome-banner 新增 signedOut 身份行 wide / compact 两用例）；TUI 冒烟 5 项全过（smoke-tui 首屏新增「Not signed in」断言——全新 HOME 的 loginRequired 启动首绘即显示该行）；`build:tui` 重建后 vendor 内 `@zcode/tui` 副本按 `installLocalTui` 同步骤手动同步（runtime 本体无变更）。

## 3.8.1-28 - 2026-09-06

### 变更

- **移除 TUI 顶部「Model access is not configured. / Run /login, or configure a custom provider in ~/.zcode/cli/config.json.」两行常驻警告**（packages/zcode-tui/src/index.ts，版本号 bump 至 3.8.1-28：VERSION、package.json、test/update.test.ts、三版 README 徽章与安装 URL）。
  - 为什么改：用户裁定不要这条提示。未配置模型访问时欢迎横幅下方常驻两行黄色警告，长期占位且引导信息与 `/login` 向导重复。
  - 改了什么：删除 `loginWarning` / `loginHelp` 两个 Text 组件、布局挂载与 `updateLoginWarning()` 方法；`loginRequired` 标志保留不动（仍驱动运行时跳过模型加载、Goal / Session usage 刷新、身份刷新时机等逻辑）。首次运行 `/login` 引导对话框内的「Model access is not configured yet.」状态说明不受影响（那是向导内的交互文案，非常驻提示）。
  - 溯源与防回归评估：该警告曾在 3.8.1-25 配套「`loginRequired=true` 时用 `readConfiguredModelAccess()` 复核、有配置不显示」的补偿逻辑，防的是「env 槽位已配置仍误报警告」的假阳性——本改动整体移除警告后该假阳性不可能再出现，属超集而非回归；代价是真正未配置模型访问的用户启动后不再有任何引导提示（首次运行向导仍在，向导内可见状态说明），此为用户裁定的预期行为。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 689 pass / 0 fail（78 files）；TUI 冒烟 5 项全过（smoke-tui / features / clear / pressure / widths）；`build:tui` 重建后 vendor 内 `@zcode/tui` 副本手动同步（当日 `sync:locked` 因 CDN 下载中断未走完整链路，runtime 本体无变更、仅复制新 dist，等价于 `installLocalTui` 步骤）。

## 3.8.1-27 - 2026-09-05

### 变更

- **API key 登录也算登录：登录判定从「仅 vault OAuth token」升级为两层（vault token 优先、官方槽位 key 次之），logout 同步清官方槽 key**（src/identity.ts、src/launcher.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts、test/login-identity.test.ts、README.md、README_zh_hans.md、README_zh_hant.md、docs/CONFIGURATION.md）。
  - 为什么改：3.8.1-26 把登录态唯一锚定在凭据库 `oauth:<provider>:access_token` 上，用户经 `/login` 粘贴 API key 完成登录后（向导提示成功、key 落盘官方槽位、模型切到官方槽位），横幅仍显示「Not signed in」、状态栏无任何身份字段——登录流程说成功、身份显示说未登录，自相矛盾；且相对 3.8.1-25（官方槽位有 key 即显示 key 身份）是显示退化，违反 3.8.1-26 立下的「用户有动作就要有正确反馈」原则。用户裁定产品语义：**经 `/login` 粘贴的 key 也是登录**，只有 custom-provider 文件（`env-` 槽位）的访问才是未登录。
  - 改了什么：① **登录判定分层**（src/identity.ts 新增 `readSignedInProvider()`）：vault OAuth token 优先；无 token 时官方 `zai`/`bigmodel` 槽位有 key 也是登录（`model.main` 指向的官方槽优先，否则 zai-first 扫描）；② **身份显示恢复 key 身份**（`readLoginIdentitySnapshot()`）：key 登录显示 key 身份，OAuth 登录仍显示账号名并绝对优先；`signedOut` 收窄为仅 `env-` 槽位访问；③ **映射名不冒充账号身份**（同日用户二次裁定）：`bigmodel-users.json` 的映射名是用户自起的 key 别名、两个账号可以同名，「Signed in as <名字>」句式仅保留给 OAuth 账号登录（系统真实读到的账号名）；key 登录一律「API key」句式——有映射为 `API key <映射名> (<脱敏 key>)`（快照新增 `keyMasked` 字段随行），无映射为 `API key <脱敏 key>`——切换账号（换 key）后显示必然变化，横幅 / 状态栏 / `zcode identity` / `zcode login` 已登录提示四处口径一致；④ **launcher 改用新判定**（src/launcher.ts 两处）：启动同步的 `skipModelBlock`（已登录不让 env 文件接管 `model` 块）与裸 `zcode login` 的「已登录即拦」都覆盖 key 登录——粘 key 登录后重启不再被钉回 `env-` 槽位；⑤ **logout 清官方槽 key**（`clearOAuthLoginCredentials()` 扩展）：除 vault 外同时清 config 官方槽位的 apiKey（`env-` 槽保留服务未登录场景）——key 登录态 logout 后真正回到未登录，而非「登出后身份还在」；⑥ **TUI 状态栏修复**（index.ts）：`signedOut` 身份不再输出状态栏字段（旧逻辑会渲染 `user` 空标签孤字）；named 身份的前缀从 `user` 改为 `key` 并带脱敏 key；⑦ `zcode identity set` 在 key 登录态下拒绝并指向 `bigmodel-users.json` 映射（key 的显示名归映射文件管，OAuth 账号名才归 identity set）；⑧ **BigModel 登录强制录入 user name**（用户裁定「不管哪种方式登录，运行 /login 就先强制输入 user-name」）：TUI 里任何经 BigModel 选项（OAuth 或粘贴 key）的 `/login`——含 plain `/login` 菜单选择与直接输入命令两种来路——在登录执行前先弹输入框收 user name（非空强制，Esc 取消即中止登录；placeholder 预示当前 key 的既有映射名）；登录成功后自动把名字 upsert 进 `bigmodel-users.json`、绑定本次落盘的 key（src/bigmodel-users.ts 新增 `writeBigmodelUserName()`，手工编辑与登录收集的条目等价可混用），显示即时刷新为 `API key <名字> (<脱敏 key>)`。Z.AI 登录不问（OAuth 流程本身回写账号名）；登录失败或取消时名字不落盘；⑨ 文档同步（三版 README 的登录权限段、Sign-in identity 节与 custom-provider 段、CONFIGURATION.md 的登录定义、登出行为与 key 映射节）。
  - 行为对照：`/login` 粘贴 key → 官方槽位落盘 + 模型切官方槽位 + 横幅即时显示「API key <映射名> (<脱敏>)」或「API key <脱敏>」+ 状态栏显示 `key <映射名> (<脱敏>)` 字段；key 登录态重启 → 模型保持官方槽位（env 文件不再接管）；`/logout` → vault + 官方槽 key 全清、横幅变回「Not signed in」、下次启动 env 文件接管模型。OAuth 登录显示「Signed in as <账号名>」与 3.8.1-26 一致不变。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 689 pass / 0 fail（78 files；identity 新增 key 登录身份 4 + readSignedInProvider 3 + identity set key 登录态 1 + writeBigmodelUserName 2 用例、logout 用例改签清官方槽 key 断言、login-identity 新增 key sign-in 3 + shouldPromptForLoginUserName 2 用例）；发版构建（release:build）时 TUI 冒烟补齐 user-name 弹框的实机覆盖（scripts/smoke-tui.ts）——BigModel 粘 key 流程在 key 回车后等名字弹框、输入 `smoke` 继续登录，新增横幅 `API key smoke (<脱敏>)` 断言与 `bigmodel-users.json` 绑定断言（映射文件按原始 key 寻址、0600 权限，与 config.json 同级合法 key 存放处，加入冒烟泄漏白名单并正向断言内容）。
  - 上游调研（2026-09-05，无代码变更）：确认上游 3.11.2（官方稳定版，领先本项目锁定的 3.8.1 三个 minor）**未解决** BigModel 登录拿不到用户名——逆向 3.11.2 runtime：共享凭证存储结构与 3.8.1 完全相同（仅 zai 有 user_info 槽位），`loginBigmodelCodingPlan` 流程逐结构同构（授权 → exchangeCode → 换 key → 写 config，全程不获取用户名）；官方 changelog 佐证（3.8.1 之后登录相关条目仅「登录态过期 / 授权回调失败 / mcp oauth 失败」三类稳定性修复）。附带发现：换 key 过程中 runtime 调 `GET bigmodel.cn/api/biz/customer/getCustomerInfo`，响应含账号 / 机构信息但只取 ID 后丢弃，且 accessToken 不落盘、流程外无法补调——据此立 T3（评估 runtime 升级 3.11.2）与 T4（调研 key → 账号信息接口）两条待办。

## 3.8.1-26 - 2026-09-05

### 变更

- **登录态成为一等公民：`/login` 授权后立即切换身份与模型显示，custom-provider 文件重新定位为「未登录场景专属」并全程自动衔接**（src/identity.ts、src/env-config.ts、src/launcher.ts、packages/zcode-tui/src/login-identity.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts、test/login-identity.test.ts、test/env-config.test.ts、README.md、README_zh_hans.md、README_zh_hant.md、docs/CONFIGURATION.md、`.env.example` 改名 `custom-provider.env.example`）。
  - 为什么改：用户在 TUI 执行 `/login` 并完成浏览器 OAuth 授权后，横幅仍显示 custom-provider 文件的脱敏 API key——登录明明成功了却看不到任何反馈。根因是 3.8.1-25 的解耦设计里身份显示跟着 `model.main` 前缀走，而该前缀被 custom-provider 文件每次启动钉在 `env-<id>` 槽位上，OAuth 写入的官方槽位与凭据库永远轮不到显示；且按旧设计「想显示登录账号须手动删除文件、登出后再手动配回」，产品上不可用。用户裁定产品原则：**用户有动作就要有正确反馈**——登录后常驻信息应切换为登录账号并显示已登录，未登录则显示未登录；custom-provider 是服务未登录场景的功能，登录态与它要兼容衔接、不能让用户来回手动增删。
  - 改了什么：① **登录态判定**（src/identity.ts 新增 `readStoredOAuthLogin()`）：凭据库 `~/.zcode/v2/credentials.json` 里 `oauth:<provider>:access_token` 的存在即登录态（`oauth:active_provider` 标记优先佐证，标记失效时扫描两家 provider 的 token）；② **身份显示登录优先**（`readLoginIdentitySnapshot()` 重写）：已登录 → 显示登录 provider 的账号身份（vault `user_info` 快照 → bigmodel key 映射 → 脱敏 key），**不再看 `model.main` 指向哪个槽位**——登录当次刷新即可见；未登录且有模型访问 → 新 kind `signedOut`，横幅 / 状态栏显示「Not signed in」，provider 显示剥离 `env-` 前缀后的声明值；无任何访问 → 维持登录向导警告。TUI 侧 `login-identity.ts` 不再镜像实现，直接复用 src 的快照函数（单一实现、杜绝双份漂移）；③ **模型归属自动切换**（env-config.ts）：启动同步时已登录则 `skipModelBlock`（只刷新 `env-` 槽位数据、不改写 `model` 块），遗留指向 `env-` 槽位的 `model` 块由新函数 `switchModelBlockToOfficialProvider()` 切到登录 provider 的官方槽位（模型 ID 官方槽位已声明则保留，否则取其第一个声明模型）；登出后下次启动未登录，文件自动重新接管 `model` 块——登录 / 登出双向无缝，文件永不需手动增删；④ **文件改名 `.env` → `custom-provider.env`**（模板同步改名 `custom-provider.env.example`，内容头部重写为新语义）：首次启动自动把旧 `~/.zcode/cli/.env` 重命名过去并提示一行（`ZCODE_ENV_FILE` 显式指定路径时不迁移）；⑤ **显示剥前缀**（env-config.ts 新增 `displayProviderId()` / `displayModelRef()`）：TUI 模型显示、`zcode identity` 的 Provider 行、`<provider-id>/<model-id>` 一律按文件里声明的原值显示（`env-bigmodel/glm-5.3` → `bigmodel/glm-5.3`），`env-` 前缀仅存于 config.json 内部槽位名（与官方槽位隔离的机制不变）；⑥ **裸 `zcode login` 闸门改为「已登录即拦」**：已登录时提示「Already signed in as <名>」并退出（`--oauth` 强制重登），未登录时即使 custom-provider 已配置也放行走 OAuth——「用户执行 login 就是要登录」；⑦ `zcode identity set` 未登录时拒绝（显示名跟随登录账号，未登录无可设）；⑧ `zcode identity` 未登录时输出 `Identity: not signed in (model access via custom provider)`。
  - 行为对照（登录 / 登出反馈闭环）：未登录 + 文件 → 模型走 `env-` 槽位、横幅「Not signed in」、模型显示 `<声明 id>/<model>`；`/login` OAuth 授权完成 → vault + 官方槽位落盘、TUI 即时刷新显示「Signed in as <账号名>」、下次启动 model 块归属官方槽位；`/logout` → vault 清空、横幅即时变回「Not signed in」、下次启动文件自动接管模型。
  - 迁移说明：升级后首次启动自动重命名 `~/.zcode/cli/.env` → `custom-provider.env`（控制台提示一行）；不想迁移可设 `ZCODE_ENV_FILE` 指回旧路径。存量已登录用户的 `model.main` 会在下次启动自动从 `env-<id>/...` 归位到官方槽位。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 674 pass / 0 fail（78 files；identity 新增登录态判定 3 用例 + 快照新口径 3 用例、login-identity 改签 signedOut 语义 + 新增 2 用例、env-config 新增迁移 2 + 显示 1 + skipModelBlock 1 + model 块切换 3 用例）。

## 3.8.1-25 - 2026-09-05

### 变更

- **新增 BigModel API key → 显示名映射表 `~/.zcode/cli/bigmodel-users.json`：按 key 自定义登录显示名（用户名 / key 名 / 任意标签均可，纯本地显示文本），切换账号不再需要重新固定显示名；登录后未配置映射时提示该功能**（src/bigmodel-users.ts 新建、src/identity.ts、src/launcher.ts、packages/zcode-tui/src/login-identity.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts、test/login-identity.test.ts、README.md、README_zh_hans.md、README_zh_hant.md、docs/CONFIGURATION.md）。
  - 为什么改：BigModel 登录（OAuth 与 API key 变体）只把换发 / 粘贴的 API key 写进 config.json、拿不到账号名，身份显示回落脱敏 key；多账号用户切换后既看不到「现在是谁」，旧机制 `zcode identity set` 又是 provider 级快照——每次切换都要手动重设，忘设就显示错误名字。按 key 维护映射表后每个 key 自带显示名，切换天然正确。
  - 改了什么：① 新建 src/bigmodel-users.ts——`bigmodelUsersPath()`（`~/.zcode/cli/bigmodel-users.json`，BigModel 登录通道专属、有意不放 `.env`）、`readBigmodelUserNames()`（容错读取：文件缺失 / 坏 JSON / 非对象一律空表，非字符串与空白条目跳过）、`resolveBigmodelUserName()`；② 身份解析（src/identity.ts 的 `readLoginIdentitySnapshot` 与 TUI login-identity.ts 的 `readLoginIdentity` 镜像接入）：优先级 vault `user_info` 快照 → **bigmodel key 查映射（命中返回新 kind `named`，横幅 / 状态栏显示 `Signed in as <名>`、状态栏前缀 `user`）** → 脱敏 key 回落；映射只对 provider `bigmodel` 生效（zai / custom 不查）；③ 提示三处：`readBigModelKeyNameHint()` 判定「bigmodel + 身份回落脱敏 key + 无映射」，TUI `/login` 不可归因变体（bigmodel-coding-plan 与两种 api-key）后经 `suggestBigModelKeyName()` 提示、CLI 裸 `zcode login` 成功后经 `printBigModelKeyNameHint()` 提示、`zcode identity` 显示脱敏 key 时附 Tip 行；提示只含脱敏 key 与文件路径，不回显完整 key。④ 测试新增 13 用例（src 侧 8：named 解析、oauth 优先、provider 限定、读取容错、hint 正负例、identity 命令 Tip 有无；TUI 侧 5：named / 未覆盖 / 坏文件 / 非 bigmodel / oauth 优先，另 loginIdentityText 补 named 文案断言）。
  - 边界说明：映射值由用户完全自主填写——user-name、key-name、account-name 或任意自定义标签均可，实现与文档均不限定语义（纯本地显示文本，不改任何认证 / 请求行为）；`.env` 通道的 `env-bigmodel` 槽位不查映射（与 `/login` 解耦的既定边界）；`zcode identity set` 机制保留不变（适用于「同账号改用户名」场景，映射适用于「多 key 多账号」场景，两者互补）。
- **修复 `/logout` 删不掉 BigModel 凭证：CLI 与 TUI 双侧拦截、补全删除清单（zai + bigmodel + 共享标记）**（src/identity.ts、src/launcher.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts）。
  - 为什么改：用户报告在 TUI 执行 `/logout` 后模型照常可用、底部仍显示账号用户名。逆向 vendor/zcode.cjs 实锤根因——runtime 的 logout 最终实现 `clearZaiLoginCredentials()` 硬编码只删 4 个固定键（`oauth:zai:access_token` / `oauth:zai:refresh_token` / `oauth:zai:user_info` / `zcodejwttoken`，且仅当 `oauth:active_provider` 解密后等于 `zai` 才顺带删它），而 BigModel OAuth 流程写入的 `oauth:bigmodel:access_token`、`oauth:bigmodel:user_info`、`oauth:login_attribution` 均不在删除清单里——CLI `zcode logout` 实测输出「Logged out from Z.AI」且凭证文件确被写入、但 vault 条目一个没少。用户名残留的直接原因即 `oauth:bigmodel:user_info` 删不掉（TUI 身份显示优先读它）。
  - 改了什么：① src/identity.ts 新增 `clearOAuthLoginCredentials()`——删除清单覆盖两家 provider 全部凭证 + 共享标记（zai 三件套、bigmodel access/refresh/user_info、`oauth:login_attribution`、`oauth:active_provider`、`zcodejwttoken`），保留无关条目（如 `zcodefeedbackclientid` 遥测 ID），幂等（vault 缺失或已清空均成功）；`runLogoutCommand()` / `isLogoutInvocation()` 组成 CLI 命令出口；② launcher.ts 在 identity 路由后拦截 `zcode logout`，不再透传 runtime（runtime 的 logout 删除清单是本实现的子集，拦截后行为是超集）；③ TUI `submit()` 对 `/logout` 本地拦截（与 `/login zai-coding-plan` 挂起同层），新增 `handleLocalLogout()`：清凭证 → notice 反馈 → `readConfiguredModelAccess()` 复核登录态（无模型访问配置才置 loginRequired 警告；`.env` / 手配用户 logout 后模型访问仍在，符合「API key 是模型访问配置、不是登录态」的语义边界）→ `setLoginRequired` 内联触发身份刷新（user_info 已删，显示回落脱敏 key 或消失）。
  - 边界说明：logout 只清 vault 登录凭证，不清 config.json 里的 API key（与官方 runtime 语义一致——OAuth 换发的 key 本身是独立有效凭证；想断模型访问须删 `.env` 或改 config）。
- **`.env` 配置改写独立 `env-<provider-id>` 槽位，与 `/login` / `/logout` OAuth 体系彻底解耦**（src/env-config.ts、packages/zcode-tui/src/index.ts、test/env-config.test.ts）。
  - 为什么改：用户本意 `.env` 是 custom provider 通道（z.ai / bigmodel.cn / deepseek 等任意 provider 通用、不影响正常登录登出），但旧实现把 `.env` 的 key 直接写进声明 id 对应的 config 槽位（`ZCODE_PROVIDER_ID=bigmodel` 就写 `provider.bigmodel`）——与 OAuth 登录写入的是同一个官方槽位，导致三方纠缠：`.env` 的 key 被当成官方登录产物（TUI 显示 OAuth 用户名）、OAuth 登录会覆盖 `.env` 配置、`zcode login` 因官方槽位有 key 而提示「无需登录」。溯源该默认是有意设计（借官方槽位压制上游登录门禁——runtime 的 `hasConfiguredCodingPlanApiKey` 只认 zai/bigmodel 两槽位），但代价即上述纠缠，与 `.env`「任意 provider 通用通道」的定位冲突。
  - 改了什么：① env-config.ts 的 `buildProviderConfig()` 输出槽位一律改为 `env-<声明 id>`（`ZCODE_PROVIDER_ID=bigmodel` → 写 `provider["env-bigmodel"]`、`model.main = "env-bigmodel/glm-5.2"`；声明 id 仍用于 baseURL 默认表与 provider 显示名）；导出 `envProviderSlotPrefix` 常量；官方 zai/bigmodel 槽位从此归 OAuth 流程独有，`.env` 与 `/login` 互不覆盖；② TUI `handleResult()` 对 runtime 推送的 `loginRequired=true` 先用 `readConfiguredModelAccess()`（槽位无关：只看 model.main 指向的 provider 是否有非空 key）复核，有配置则不显示「Model access is not configured」警告——补偿 runtime 登录门禁只认官方两槽位的行为，`env-*` 槽位与手配 custom provider 均受益；③ 身份显示无需改动自动退化（login-identity.ts 只对 zai/bigmodel 查 vault 的 user_info，`env-*` 槽位显示脱敏 key）。
  - 迁移说明：升级后首次启动 `.env` 同步即切到 `env-*` 槽位；旧官方槽位残留的 key 保留不删（无害残留，OAuth 登录可正常覆盖它）。存量用户界面上的模型标识会从 `bigmodel/glm-5.3` 变为 `env-bigmodel/glm-5.3`（语义更准确：这是 `.env` 通道的配置）。
  - 验证：`tsc --noEmit` 通过；全量 `bun test` 644 pass / 0 fail（78 files；env-config 槽位断言更新 +「官方槽位不被 `.env` 触碰」用例加强、identity 新增 logout 5 用例）。

## 3.8.1-24 - 2026-09-04

### 变更

- **任务计时行右侧常驻显示当前工作目录（多开会话可分辨）**（packages/zcode-tui/src/turn-status.ts、packages/zcode-tui/src/index.ts、packages/zcode-tui/src/welcome-banner.ts、test/turn-status.test.ts）。
  - 为什么改：当前目录路径此前只在欢迎横幅里显示，长会话中横幅被对话内容冲出屏幕后，多开的几个 zcode TUI 界面无法分辨各自对应哪个目录。把目录放到回合状态行（任务计时所在行）、紧邻计时右侧常驻显示，随计时刷新一直在场。
  - 改了什么：① welcome-banner.ts 把 home 前缀折叠为 `~` 的 `displayWorkspace()` 逻辑提取为导出函数 `abbreviateWorkspaceDirectory()`（横幅与计时行共用同一缩写口径）；② turn-status.ts 新增 `turnStatusDirectoryText()`——工作目录缩写为 `~` 形式，超过 24 列（`TURN_STATUS_DIRECTORY_MAX_COLUMNS`）预算时从头部截断、保留尾部（多开会话的区分度主要在路径末段的项目名）；预算取 24 是为在 80 列终端上给右侧 Goal 状态留出空间（实测 80 列下计时 + 目录 + compact Goal 三者共存；更窄终端优先保计时 + 目录）；③ index.ts `updateTurnStatus()` 把目录文本（muted 样式、` ─ ` 分隔）拼到计时文本右侧，无计时内容时目录单独显示；目录文本经 `sanitizeTerminalText` 清洗并缓存（进程生命周期内 cwd 不变，`??=` 只算一次）。④ 测试新增 3 用例（banner 同款缩写、超预算头部截断保尾部、宽字符目录截断不切坏字符）。
  - 验证：`bun test` 全量 639 pass / 0 fail（78 files）；`tsc --noEmit` 通过；多宽度渲染实测（100 / 80 / 60 列）确认布局符合预期；`build:tui` 重建后 vendor 内 `@zcode/tui` 副本同步刷新（cmp 与构建产物一致）。
- **修复切换账号登录后 TUI 仍显示旧账号用户名：登录后无条件刷新身份显示 + 不可归因登录按 API key 变化自动清除陈旧快照**（src/identity.ts、packages/zcode-tui/src/index.ts、test/identity.test.ts、test/login-flow.test.ts、README.md、README_zh_hans.md、README_zh_hant.md）。
  - 为什么改：用户报告切换账号重新登录后，TUI 横幅与状态栏仍显示旧账号的用户名。排查实锤两层根因——① **会话层**：`setLoginRequired` 只在 `loginRequired` 从 true 翻转到 false 时才刷新身份显示，已登录状态下切换账号时该状态始终是 false，`refreshLoginIdentity` 永远不触发，旧名一直挂到重启 TUI；② **数据层**：显示名读的是 vault 的 `oauth:<provider>:user_info` 快照，其中 Z.AI OAuth 登录流程每次都会用新账号的 user 对象重写快照（runtime `saveZaiLoginCredentials`，逆向实锤），但 BigModel OAuth 与两种 API key 登录变体只把新 API key 写进 config.json、从不回写快照（逆向实锤：runtime 对 `oauth:bigmodel:*` 键零引用，本机 vault 里该条目是已卸载的 ZCode Desktop 遗留）——切到另一个 BigModel 账号后快照里的名字属于旧账号，重启也刷不掉，且 CLI 无从拿到新账号用户名（换 token 全程在 runtime 进程内、实时拉取接口被 WAF 拦截，见上一条目）。
  - 改了什么：① src/identity.ts 新增 `readProviderApiKeySnapshot()`（登录前快照 zai / bigmodel 两 provider 的 config API key）与 `clearIdentitiesWithChangedKeys(before)`（登录后对比，key 变了的 provider 其 user_info 快照无法再归因到当前账号，删除之，返回清除列表）；② TUI `setLoginRequired` 改为每次调用都 `refreshLoginIdentity()`（不再只看状态翻转——已登录切账号也要刷新），`refreshLoginIdentity` 改值比较（kind + label 相同则早退，避免每次 result 重绘）；③ 新增 `isLoginWithoutIdentityRefresh()` 判定三类不可归因登录命令（`/login bigmodel-coding-plan`、两种 `-api-key` 变体；Z.AI OAuth 除外——它自己会重写快照），`submit()` 对这类命令在 `submitPrompt` 前做 key 快照、`handleResult` 后调用新增的 `clearStaleIdentityAfterLogin()`：key 变了 → 清快照 + 刷新显示 + 提示可用 `zcode identity set <名称>` 固定新名；key 没变（同账号重登）→ 保留原名。④ 测试新增 7 用例（identity 5 个：快照只含 vault 型 provider、key 变清快照且保留相邻条目、key 不变保留、zai key 变同样清、无快照 no-op；login-flow 2 个：判定函数正负例），全量 `bun test` 636 pass / 0 fail（78 files），`typecheck` 通过；`build:launcher` + `build:tui` 重建，vendor 内 `@zcode/tui` 副本同步刷新。
  - 边界说明：本修复保证「切换账号后不再显示旧账号名」（Z.AI 切换直接显示新名；BigModel / API key 切换回落显示脱敏 API key 并提示手动固定新名）——BigModel 登录链路拿不到新账号用户名是上游 runtime 的结构性限制（token 不落盘），自动显示新 BigModel 用户名需上游支持，不在本修复范围。
- **新增 `zcode identity` 子命令：查看 / 手动同步登录身份显示名（解决改名后 TUI 仍显示旧用户名）**（src/identity.ts 新建、src/usage.ts、src/launcher.ts、test/identity.test.ts 新建）。
  - 为什么改：用户在 bigmodel.cn 改了用户名，TUI 横幅与状态栏仍显示旧名。排查实锤根因——显示名读的是本机共享凭证库 `~/.zcode/v2/credentials.json` 的 `oauth:bigmodel:user_info` **加密快照**（含 username / displayName），该快照是 ZCode Desktop 当年 OAuth 登录时写入的（Desktop 与 CLI 共享 vault）；此后无任何机制刷新它：Desktop 已卸载，官方 runtime 的 bigmodel 登录流程（逆向 vendor/zcode.cjs 实锤）只把换发的 API key 写进 `~/.zcode/cli/config.json`、从不写 vault 的 user_info——所以重新 `zcode login` 也刷不掉旧名。实时从服务端拉最新用户名不可依赖：正主端点 `GET bigmodel.cn/api/biz/customer/getCustomerInfo`（网页个人中心与 runtime 登录链路 `Ghr→Uhr` 同款）当前从本机直连 / 走代理均被阿里云 WAF 挑战拦截（200 + 空 body + `acw_tc` cookie），monitor 域又无用户信息端点。故提供手动同步命令作为唯一可靠刷新途径。
  - 改了什么：① src/usage.ts 新增 `encryptCredential()`——`decryptCredential()` 的对偶（`enc:v1:` AES-256-GCM、随机 12 字节 IV、16 字节 tag、三段 base64url，密钥派生与 runtime 同款），使 CLI 可回写 runtime 可读的加密凭证；② 新建 src/identity.ts——`zcode identity` 显示活跃 provider 的身份（OAuth 账号名或脱敏 API key，读取优先级与 TUI 的 login-identity.ts 镜像，包依赖方向不允许反向 import 故独立实现）；`zcode identity set <name>` 重写活跃 provider（`oauth:active_provider` 标记优先，回落 config.model.main 前缀，缺省 bigmodel）的 user_info 快照 username + displayName，保留 id / avatarUrl 等其它字段与 vault 相邻条目（login_attribution 等），无快照时新建条目；`zcode identity clear` 删除快照回落 API key 显示；名称上限 64 字符，非 OAuth provider 拒绝 set；vault 回写 0600 权限；③ launcher.ts 在 stats 路由后接入 identity 路由；④ 新建 test/identity.test.ts 13 用例（加解密往返 + 随机 IV、命令参数判定、快照读取三优先级、set 保留字段 / 新建条目 / 两类拒绝、show / clear / no-op / 缺失态）。`bun run build:launcher` 重建，全量 `bun test` 630 pass / 0 fail（78 files）。本机实测 `zcode identity` 输出 `Provider: bigmodel / Identity: signed in as <旧名>`（复现问题现场）；vault 全局共享，set 后 TUI 新会话即生效。
  - 边界说明：`identity set` 是「本地显示名同步」，不改服务端账号信息；若未来 WAF 放行实时接口，可再立项自动刷新（当前不立项——实时拉取在现网不可用，自动刷新会静默失败回落旧快照，徒增复杂度）。
  - 版本说明：本批改动原被记在 3.8.1-23 条目下，但 v3.8.1-23 已发 GitHub Release（2026-09-04，Release notes 不含这两条），故 commit 后 bump 版本号 3.8.1-23 → 3.8.1-24 并将两条归位至本条目（3.8.1-23 条目恢复为发布时形态）；同步更新 VERSION、package.json、test/update.test.ts 断言、三版 README 徽章与安装 URL 资产名。

## 3.8.1-23 - 2026-09-04

### 变更

- **TUI 会话工厂启用 workspace-hook 信任体系：bootstrap 传 `workspaceHookTrustEnabled: true`（TODO T1 完成）**（scripts/sync-runtime.ts、scripts/check-runtime.ts、vendor/zcode.cjs、test/sync-runtime.test.ts、TODO.md、TODO-archive.md 新建）。
  - 为什么改：runtime 已内置完整的项目级 workspace hooks 信任体系（`pending_trust → trusted_persistent` 状态机、声明 sha256 + bundle 摘要绑定、持久 trust store `~/.zcode/security/workspace-hook-trust-v1.json`、`zcode hooks trust status/grant/revoke` 命令族），headless 协议路径（`--prompt`）也已自带 `workspaceHookTrustEnabled:!0`；唯独 zcode-cli 的 TUI 会话工厂从未传该参数 → runtime 侧恒 false → 项目级 hooks 整体禁用（CLI grant 已授信也无效，每次会话日志打 `workspace_hook.feature_disabled`）。后果是 DayTradingAgent 被迫把两条安全 hook 挂到用户级 `~/.zcode/cli/config.json` 兜底，而该路径 2026-09-04 实测会被客户端设置保存的旧快照整体重写冲掉——项目级单源才是稳态。
  - 改了什么：① `sync-runtime.ts` 新增 `patchRuntimeWorkspaceHookTrust(runtime)`——锚定 TUI 会话工厂的唯一锚点（`…,onWorkflowEvent:b.onWorkflowEvent})`）注入 `,workspaceHookTrustEnabled:!0`；幂等（已打补丁原样返回），锚缺失 throw 含 `incompatible`；挂进 `installTuiBridge` 补丁链（`patchRuntimeHttpNoContent` 与 `patchRuntimeAgentAutoBackground` 之间）。② `check-runtime.ts` 幂等校验链同步加一行。③ `vendor/zcode.cjs` 补丁实际写入（净增 29 字节，落点 offset ≈12365683），`node --check` 语法通过。④ `test/sync-runtime.test.ts` 新增用例（注入断言 + 幂等 + incompatible throw；fixture 不可用 `new Function` 执行，采用纯字符串断言）。
  - E2E 验证（tmp/smoke-hook-trust.ts，gitignore 内可复跑）：临时 HOME + 项目级 SessionStart hook 全流程——未授信时新会话日志**无** `workspace_hook.feature_disabled`（补丁生效）、config 装载打 `config.project_hooks.pending_trust`、hook 被 trust gate 拦住不执行（标记文件不出现）；`zcode hooks trust grant`（CLI 路径，状态转 `workspace_hooks_trusted_persistent`）后新会话 hook **实际执行**（标记文件出现）、日志仍无 `feature_disabled`。排查沉淀两点：① SessionStart hook 在首个 turn（用户首条输入触发 `runSessionStartHooks("startup")`）执行、非 TUI 启动即执行，自测须发一条消息；② macOS `/tmp → /private/tmp` 符号链接会让 CLI 授信记录的 workspaceIdentity 与 TUI 会话从 cwd 解析的身份不一致（grant 落不到会话上），冒烟沙箱须放在无符号链接路径（项目 `tmp/` 下）——真实工作区路径稳定，不受影响。
  - 验证口径：`bun test test/sync-runtime.test.ts` 26 pass；全量 `bun test` 617 pass / 0 fail（77 files）；`bun run check` 通过（zcode-cli 3.8.1-23 / zcode-runtime 0.16.3）。DayTradingAgent 侧后续动作（其 TODO T140 ②③）：新 ZCode 会话重跑 cat 凭证探针（应仍被拦、改由项目级挂载拦截）→ 撤回用户级两条上移、切回项目级单源。
  - 待办闭环：T1 归档进新建的 TODO-archive.md；同源风险（客户端设置保存用内存旧快照整体重写 config.json、冲掉外部对 hooks 段的修改）立项为 TODO **T2**（🟠 橙色紧急度）。

- **新建项目根 TODO.md、登记 T1（会话 bootstrap 传 `workspaceHookTrustEnabled: true`）**（TODO.md 新建）。
  - 为什么改：DayTradingAgent（Victor）侧 2026-09-03~04 验证发现 zcode-cli 构造会话时从不传该参数 → runtime 已内置的项目级 workspace hooks 信任体系被宿主能力开关整体禁用（CLI grant 已授信、trust store 已持久化，只差这个开关）；按跨项目分工，该开发主体从 DayTradingAgent TODO T140 ① 拆转到本项目登记。
  - 改了什么：新建 TODO.md（四级紧急度分节框架 + 编号时间戳规范），登记 🟠 T1——含任务描述、`vendor/zcode.cjs` 三处 offset 定位材料（构造点 ≈11703354、bootstrap 消费点 ≈11762913、`!0` 参考样例 ≈11922028）、完成后验证口径（DayTradingAgent 侧新会话重跑凭证探针 + 日志无 `feature_disabled`，随后撤回用户级兜底切项目级单源）、同源风险提示（2026-09-04 实测客户端设置保存用旧配置快照整体重写 config.json、冲掉外部对 hooks 段的修改——是否另行立项待裁定）。本项目尚无 TODO-archive.md（首条待办、暂无归档），随首次归档再建。

## 3.8.1-22 - 2026-09-02

### 变更

- **登录身份显示修正：OAuth 登录优先显示账号用户名，而非登录换发的 API key**（packages/zcode-tui/src/login-identity.ts、test/login-identity.test.ts、VERSION、package.json、test/update.test.ts、README.md、README_zh_hans.md、README_zh_hant.md）。
  - 为什么改：3.8.1-21 的实现按「provider 显式 apiKey 优先于 OAuth 凭证」判定身份，本机用户已 OAuth 登录 bigmodel.cn，TUI 却显示 `API key 916c…b5xW`——与用户要求（显示登录账号用户名）相反。逆向 vendor bundle 确认根因：runtime 的 OAuth 登录流程会用 access_token 换发 API key 并写入 config 的 `provider.options.apiKey`（zai / bigmodel 两条路径同构：`saveZaiLoginCredentials` 存凭证 → `Utn` 换 key → `UY` 写 config）——即「OAuth 登录态 + config 显式 key」并存时，那个 key 正是登录的产物、与登录账号是同一身份，「显式 key 优先」的语义判定本身就是错的。
  - 改了什么：readLoginIdentity 优先级反转为「OAuth 账号名优先，无 OAuth 登录态才显示脱敏 key」——provider 为 zai / bigmodel 时先解密凭证文件的 `oauth:<provider>:user_info` 取 displayName / username，取到即显示 `Signed in as <用户名>`；凭证缺失 / 解密失败 / 非 OAuth provider 时回退显示 `API key <脱敏key>`，两者皆无返回 undefined。测试同步：原「显式 key 优先于 OAuth」用例反转为「OAuth 账号优先于换发 key」，新增「user_info 解密失败时回退显示 key」「自定义 provider 显示脱敏 key」两个用例（login-identity + welcome-banner 共 29 例通过）。版本号 3.8.1-21 → 3.8.1-22（3.8.1-21 已发 GitHub Release，v3.8.1-21 实测存在；bump 同步 VERSION、package.json、test/update.test.ts 断言、三版 README 徽章与安装 URL 资产名）。

## 3.8.1-21 - 2026-08-28

### 变更

- **TUI 显示登录身份：启动横幅与状态栏展示登录账号用户名 / API key 形态**（packages/zcode-tui/src/login-identity.ts 新建、packages/zcode-tui/src/welcome-banner.ts、packages/zcode-tui/src/index.ts、test/login-identity.test.ts 新建、test/welcome-banner.test.ts、README.md、README_zh_hans.md、README_zh_hant.md）。
  - 为什么改：TUI 交互界面此前没有任何登录状态显示——已登录用户看不到自己登录的是哪个账号（多账号 / 多 key 场景下无法确认当前身份），用户要求显示 zcode 的登录状态与登录账号用户名。
  - 改了什么：① 新建 login-identity.ts：读 `~/.zcode/cli/config.json` 的 `model.main` 确定激活 provider——provider 配了显式 apiKey 即为 API key 模式（label 为脱敏 key，前 4 + 后 4 位）；无显式 key 且 provider 为 zai / bigmodel 时解密 `~/.zcode/v2/credentials.json` 的 `oauth:<provider>:user_info`（复用 src/usage.ts 的 `enc:v1:` AES-256-GCM 解密与脱敏函数，TUI 经相对路径 import、构建时 bundle 进 dist），取 displayName（缺失退 username，截 24 字符）为 OAuth 账号模式；两者皆无则返回 undefined（不显示，未登录状态由既有「Model access is not configured」警告覆盖）。② WelcomeBanner 新增身份行（wide 版信息面板、compact 版各加一行）：OAuth 显示 `Signed in as <用户名>`、API key 显示 `API key <脱敏key>`；新增 `setIdentity()` 支持不重建布局原地更新。③ index.ts：启动时（buildLayout 前）读取一次身份（loginRequired 时不读）；`/login` 挂起登录成功等触发 `setLoginRequired(false)` 的路径自动重读刷新横幅；底部状态栏（updateMetadata）新增常驻身份字段（`user <用户名>` / `key <脱敏key>`，低优先级 25，窄屏先于模型 / 上下文信息被挤掉）。④ 测试：新建 test/login-identity.test.ts 共 11 个用例（OAuth 账号名、displayName 缺失退 username、显式 key 优先于 OAuth 凭证、provider 与凭证 key 不匹配返回 undefined、自定义 provider、无 model.main、config 缺失、解密失败、超长截断、文本组装），welcome-banner 测试补 6 个身份行用例（wide / compact 渲染、API key 形态、超长截断不换行、setIdentity 更新、终端控制符清洗）；三版 README 的「登录与权限」功能段同步补登录身份显示一句。typecheck、相关测试 47 例、`bun run build`、smoke-tui-widths / smoke-tui-features / smoke-tui（注入新 TUI 后 3/3 通过）、verify:tui-perf 均通过，真实 HOME 实测 banner 显示 `API key 916c…b5xW`、状态栏显示 `key 916c…b5x`（本机为显式 key 形态）。

- **LICENSE 恢复上游版权行（修复 MIT 合规缺陷）**（LICENSE.md、README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：本项目 fork 自 kingsword09/zcode-cli（上游原项目名 zcode-app-cli），fork 时把上游 LICENSE 的版权行「Copyright (c) 2026 zcode-app-cli contributors」替换成了「All Contributors」——MIT 许可证唯一的硬性条件就是保留原版权声明，替换即违规。正确做法是原行保留、自己追加新行，而不是替换。
  - 改了什么：LICENSE.md 版权行改为两行并存（上游「zcode-app-cli contributors」在前、「All Contributors」在后追加）；三版 README 的版权与署名段同步补上游版权行（「版权所有 (c) 2026 zcode-app-cli contributors（上游项目）」）。LICENSE 末尾的 runtime 限定句（「本许可证只覆盖仓库自身封装代码，不授予 ZCode 及提取出的 runtime 的任何权利」）上游即有、fork 时已保留，本次核实无需改动。

- **繁体版 README 从台湾地区用词改为通用繁体**（README_zh_tw.md）。
  - 为什么改：用户指出繁体版 README 不要针对台湾地区的特有词汇（台湾国语用词），用通用繁体（大陆用词对应的繁体字形写法）即可——原版大量使用台湾特有词汇（專案、檔案、外掛、伺服器、快取、指令、登入、預設、精靈、支援等），与作为权威基准的简体版用词不一致。
  - 改了什么：以 README_cn.md 为基准逐段重写，台湾特有用词全部替换为对应大陆用词的通用繁体写法——專案→項目、檔案→文件、外掛→插件、伺服器→服務器、快取→緩存、指令→命令、登入→登錄、預設→默認、精靈→嚮導、支援→支持、使用者→用戶、用戶端→客戶端、擷取→提取、實作→實現、搜尋→搜索、導覽→導航、連結→鏈接、佇列→隊列、市集→市場、剪貼簿→剪貼板、貼上→粘貼、游標→光標、詮釋資料→元數據、儲存庫→倉庫、儲存→保存、離峰→非高峰、回呼→回調、串流→流式、字元→字符、自訂→自定義、略過→跳過、匯入→導入、散布→分發、管道→渠道、套件→包、全域→全局、重灌→重裝、本機→本地、內建→內置、互動→交互、建置→構建、範本→模板、變數→變量、覆寫→覆蓋、逾時→超時、二進位→二進制、彙總→聚合 / 匯總、遮蔽→脫敏、擱置→掛起、核准→審批、情境→上下文、訊息→消息、傳送→發送、設定→設置 / 配置（按简体版逐处对齐）；目录锚点同步（#設定→#配置、#外掛管理→#插件管理、#工作區整合→#工作區集成）；顺手修正原版「[設定](…)仲介紹」的错位断词（「中介」→「中 + 介紹」）。信息内容与简体版逐段对齐（文件名于同周期内改为 README_zh_hant.md，见下条）。

- **中英双语 README 文件名改用文字码命名：README_cn.md → README_zh_hans.md、README_zh_tw.md → README_zh_hant.md**（README_cn.md 改名、README_zh_tw.md 改名、README.md）。
  - 为什么改：繁体版内容已改为通用繁体（见上条），文件名却仍是 `zh_tw`（指向台湾中文的区域语言代码），名实不符；`zh-Hans` / `zh-Hant` 是 ISO 15924 文字码（经 IETF BCP 47 用于语言标签），只区分简繁、不带地域指向，正好匹配「通用繁体 / 简体」定位；简体版 `README_cn.md` 的 `cn` 同为区域码，一并改为 `README_zh_hans.md`，两个中文版命名统一为文字码体系。
  - 改了什么：文件系统 `mv` 改名两个文件（不经 git、暂存区未动，新文件名待 git add）；三版 README 语言导航行互链同步指向新文件名（README.md、README_zh_hans.md、README_zh_hant.md）；全仓确认无其它活引用（CHANGELOG 历史条目中的旧文件名为当时事实记录，保留不改）。

- **版本号 3.8.1-20 → 3.8.1-21**（VERSION、package.json、test/update.test.ts、README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：3.8.1-20 已发 GitHub Release（v3.8.1-20，2026-08-26），本次 LICENSE 修正是其后新变更，按项目 `3.8.1-N` 后缀递增惯例 bump 进新版本节。
  - 改了什么：VERSION、package.json、`test/update.test.ts` 的「Current version」断言、三版 README 徽章同步改为 3.8.1-21。

- **Ctrl+V 升级为智能粘贴：剪贴板有图贴图、无图退回贴文本**（packages/zcode-tui/src/clipboard-text.ts 新建、packages/zcode-tui/src/index.ts、packages/zcode-tui/src/types.ts、README.md、README_zh_hans.md、README_zh_hant.md）。
  - 为什么改：用户希望 Cmd+V 一个键同时贴图和贴文本（符合 macOS 使用习惯）。但 Cmd+V 是终端级快捷键、按下即被终端截获为「粘贴文本」，永远到不了 TUI，zcode 层面无法分流；唯一可行路径是在终端把 Cmd+V 键映射为发送 Ctrl+V 的控制字符（\x16），再让 zcode 的 Ctrl+V 自己分流。而原 Ctrl+V 只读图——剪贴板没图时仅提示「No supported image found in the clipboard.」、文本也不贴，键映射方案会丢掉贴文本能力。故给 Ctrl+V 补上文本回退，使其成为「有图贴图、无图贴字」的智能粘贴，让终端键映射后的 Cmd+V 完整复刻原生粘贴直觉。
  - 改了什么：① 新建 clipboard-text.ts：跨平台读剪贴板文本的内置实现（darwin 用 pbpaste；linux 依次尝试 wl-paste --no-newline 与 xclip；win32 用 powershell Get-Clipboard -Raw；输出上限 1 MiB 截断防超大文本；宿主可经新增的 options.readClipboardText 回调注入覆盖）。② index.ts：Ctrl+V 改调新的 pasteFromClipboard——turn 空闲时先读图（runtime 注入的 readClipboardImage，读图异常视同无图），有图加附件；无图则读文本插入编辑器（多行文本由编辑器 insertTextAtCursor 原生处理、可撤销）；turn 进行中不加图、但文本照常插入（与原生粘贴行为一致）。/paste-image 命令保持原语义不变（只贴图、无图时提示）。三份 README 的功能列表与「图片附件」章节同步更新。

- **三版 README 安装命令 URL 资产名 3.8.1-20 → 3.8.1-21**（README.md、README_zh_hans.md、README_zh_hant.md）。
  - 为什么改：安装 URL 用 `releases/latest/download/zcode-cli-<版本>.tgz` 形式，资产名必须与 latest Release 的 asset 完全一致才能下载；本次 3.8.1-21 发布后 latest 将指向新版本，沿用 3.8.1-20 那轮的「发版前预对齐」做法，发布后 URL 立即恢复可下载。
  - 改了什么：三版 README 各 3 处安装 URL 的资产名 `zcode-cli-3.8.1-20.tgz` 统一改为 `zcode-cli-3.8.1-21.tgz`。

## 3.8.1-20 - 2026-08-26

### 变更

- **`ZCODE_API_KEY` 支持多 key 容灾：本地回环代理按 key 轮换重试**（src/key-failover.ts 新建、src/env-config.ts、src/launcher.ts、.env.example、test/key-failover.test.ts 新建、test/env-config.test.ts、docs/CONFIGURATION.md、README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：用户要求多把 bigmodel coding plan key 做容灾——端点不变、同一端点下配多把 key，某把 key 的请求失败时直接切换另一把继续；此前每个 provider 只支持单 key，key 失效 / 限流只能手动换。多 key 的配置格式同日由「`ZCODE_API_KEY` 逗号分隔多把 key」改为「每把 key 一个变量」（用户裁定：不要一个变量里逗号分隔）。
  - 改了什么：① 多把 key 每把一个变量：主 key 仍是 `ZCODE_API_KEY`，备用 key 用编号变量 `ZCODE_API_KEY_2`、`ZCODE_API_KEY_3`……（按编号升序去重合并；解析宽容收集任意 `ZCODE_API_KEY_<正整数>`）；`.env.example` 模板以注释变量行 `#ZCODE_API_KEY_2=`、`#ZCODE_API_KEY_3=` 直接列出备用 key 变量，取消注释填值即可启用。多于一把时 launcher 在拉起 runtime 前启动只绑 127.0.0.1 的本地容灾代理（端口从 7849 起找空闲，避免多实例冲突），并把 `.env` 同步写入 config.json 的 provider 条目改写为：baseURL 指向代理（保留上游端点路径）、apiKey 写占位符 `zcode-failover`——真实 key 只存在于 `.env` 文件与代理内存，不落 config.json。② 代理逐请求注入当前 key（替换 x-api-key / authorization 的值，其余 header 原样透传）：上游返回 401/403/429/5xx 或连接失败时，换下一把 key 用同一请求体重试，成功（含 2xx 与不可切换的 4xx）后流式透传响应（SSE 不受影响）并记住健康 key 作为下次起点；全部 key 失败则回传最后一次上游响应，runtime 自带的重试与报错逻辑不受影响。③ 切换事件追加记录到 `~/.zcode/cli/key-failover.log`（key 脱敏为前 4 + 后 4 位，超 1 MiB 轮转），不打终端以免扰乱 TUI。④ 单 key 时行为与原来完全一致（直连、无代理）。⑤ 测试：新建 test/key-failover.test.ts 共 12 个用例（key 变量合并 / 脱敏、401 切换 + 健康 key 记忆、全败回传、上游不可达 502、4xx 透传不切换、流式透传、占位凭证替换、健康端点、端口冲突递增、少于两把 key 报错），env-config 测试补多 key 构建 / 降级 / 端点解析 / 同步写入用例；全量 598 测试通过、typecheck 与 `bun run check` 通过。⑥ 沙箱端到端实测：两把假 key 打真实 bigmodel 端点，确认 runtime 请求打到代理（`http://127.0.0.1:7849/api/anthropic/v1/messages`）、config.json 写入占位 key 与代理地址、日志记录 key#0 → 401 → failover → key#1 → 401 → 回传（变量格式调整后复测通过）。注意：多把 key 必须同属一个端点（容灾只轮换 key，不改端点）。

- **项目根新增软链接 `AGENTS.md` → `.claude/CLAUDE.md`**（AGENTS.md 新建）。
  - 为什么改：AGENTS.md 是多家 agent 工具（如 ZCode 等）的项目级指令约定入口，读取的是项目根 `AGENTS.md`；此前本项目指南只存在于 `.claude/CLAUDE.md`（Claude Code 的入口），其它工具读不到。用软链接打通后两套入口共享同一份内容，单一源头维护、不会两处分叉。
  - 改了什么：`ln -s .claude/CLAUDE.md AGENTS.md`（相对路径软链接，clone 到任何机器都有效）；`.claude/CLAUDE.md` 本身不动。

- **三版 README 安装命令 URL 资产名 3.8.1-17 → 3.8.1-20**（README.md、README_cn.md、README_zh_tw.md）。
  - 为什么改：安装 URL 用 `releases/latest/download/zcode-cli-<版本>.tgz` 形式，资产名必须与当前 latest Release 的 asset 完全一致才能下载；自 3.8.1-18 发布起 latest 已不再是 3.8.1-17，三版 README 的安装命令一直 404（「发布后在下一个变更里更新 URL」的约定在 3.8.1-18、3.8.1-19 两轮均未执行）。
  - 改了什么：三版 README 各 3 处安装 URL 的资产名 `zcode-cli-3.8.1-17.tgz` 统一改为 `zcode-cli-3.8.1-20.tgz`，与本次将发布的 Release 对齐——本次 Release 发布后 URL 即恢复可下载。

- **版本号 3.8.1-19 → 3.8.1-20**（VERSION、package.json、test/update.test.ts、CHANGELOG.md）。
  - 为什么改：3.8.1-19 已发 GitHub Release（v3.8.1-19，2026-08-23）且其后有新提交（多 key 容灾 1215f67、AGENTS.md 软链接），按项目 `3.8.1-N` 后缀递增惯例 bump；bump 提交 23f3956 更新了 VERSION、package.json、README 徽章与 CHANGELOG 标题，但漏改 `test/update.test.ts` 硬编码的版本断言（仍为 3.8.1-19），导致 `release:build` 全量 598 测试中 1 例失败、/release 流程在发布前校验被拦停。
  - 改了什么：`test/update.test.ts` 的「Current version」断言同步改为 3.8.1-20（已核实为全仓唯一漏改处，其余文件无旧版本号残留），补齐后重走完整发布构建与发版流程。

## 3.8.1-19

### 变更

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
