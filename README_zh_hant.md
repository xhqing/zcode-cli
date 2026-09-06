# ZCode CLI

<div align="center">

![ZCode CLI](./assets/logo.svg)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/Version-3.8.1--30-blue.svg)](./CHANGELOG.md)
[![Type](https://img.shields.io/badge/Type-CLI_Tool-blue.svg)]()

[English](README.md) | [简体中文](README_zh_hans.md) | 繁體中文

</div>

非官方的 ZCode 終端客戶端，直接運行 ZCode Desktop 附帶的官方 agent runtime。

本項目提取上游 `resources/glm` runtime，注入基於
[`@earendil-works/pi-tui`](https://github.com/earendil-works/pi/tree/main/packages/tui)
的本地 `@zcode/tui` 實現，並以 Node.js 子進程直接繼承用戶終端的方式啟動。

本項目與 Z.ai 無隸屬關係、也未獲其背書。ZCode 及其附帶的 runtime 仍受上游條款約束；
發布前請先確認你有權再分發提取出的 runtime。

![ZCode CLI TUI demo](./docs/assets/demo.svg)

## 快速開始

```bash
npm install -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-30.tgz
zcode
```

首次啟動時，ZCode 會創建 `~/.zcode/cli/config.json`（Windows 上為
`%USERPROFILE%\.zcode\cli\config.json`），寫入免憑證的默認配置，並在 TUI 中打開
設置嚮導。嚮導會依次引導[配置](./docs/CONFIGURATION.md)中介紹的三種模型接入方式；
若本地裝有 ZCode 桌面版，還可導入桌面版的 provider 配置（憑證仍需重新登錄，類似
瀏覽器導入用戶資料）。隨時可用 `/setup` 重新打開嚮導；按 Esc 跳過。

## 目錄

- [快速開始](#快速開始)
- [安裝與更新](#安裝與更新)
- [用量統計](#用量統計)
- [架構](#架構)
- [功能特性](#功能特性)
- [工作區集成](#工作區集成)
- [插件管理](#插件管理)
- [環境需求](#環境需求)
- [配置](#配置)
- [本地開發](#本地開發)
- [參與貢獻](#參與貢獻)
- [版權與署名](#版權與署名)

## 安裝與更新

```bash
npm install -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-30.tgz
# 或
bun add -g https://github.com/xhqing/zcode-cli/releases/latest/download/zcode-cli-3.8.1-30.tgz
```

GitHub Release 是唯一的分發渠道，本項目不發布到 npm。包名為
`zcode-cli`，命令為 `zcode`。

已安裝的用戶升級只需執行：

```bash
zcode --update
```

該命令經 `gh` CLI 從 GitHub Release 解析最新版本，下載 Release 上掛的
`zcode-cli-<版本>.tgz` asset 後全局重裝。GitHub Release 是唯一的更新
渠道——每個 Release 都附帶該 tarball asset。

交互式啟動時，每 20 小時至多檢查一次 GitHub Release 最新版（按已安裝版本計），
有新版本時以非阻塞的更新卡片提示，附精確的更新命令與 release notes 鏈接。CI 環境
自動跳過檢查。設置 `ZCODE_DISABLE_UPDATE_CHECK=1` 或 `NO_UPDATE_NOTIFIER=1`
可關閉。

正常安裝只需 Node.js，無原生 PTY 擴展、無 postinstall 構建步驟。

## 用量統計

```bash
zcode stats          # 人類可讀報告
zcode stats --json   # 機器可讀 JSON
```

ZCode runtime 會把每次模型請求記錄到本地 SQLite 數據庫
（`~/.zcode/cli/db/db.sqlite`）。`zcode stats` 按 **provider**（即
`~/.zcode/cli/config.json` 裏的每個 provider 條目）聚合歷史用量，API key
脫敏為前 4 位與後 4 位。每段列出請求數與錯誤數、**輸入 token、緩存命中
token 與命中率、輸出 token**，並按官方 GLM Coding Plan 係數（積分 = token ×
係數 ÷ 10000，非高峰時段 5 折）估算**分輸入 / 緩存 / 輸出三項的積分消耗**；
無公開係數表的模型跳過並標註。末行匯總全部 provider。

zcode-cli 的模型請求由官方 ZCode runtime 發出（請求頭帶
`User-Agent: ZCode/<版本>`），官方針對 ZCode 的促銷優惠同樣適用。本地存有
`zcode login` 登錄的 BigModel OAuth 憑據時，`zcode stats` 會調用廠商 monitor
接口（與 ZCode Desktop 用量頁同源），追加一份**服務端真實積分報告**——按
模型列出實際抵扣積分（已含促銷與非高峰折扣），並分輸入 / 緩存 / 輸出三桶。無
憑據或請求失敗時省略該段、僅保留本地估算。

## 登錄身份

```bash
zcode identity              # 查看活躍 provider 的登錄身份
zcode identity set <名稱>   # 手動同步本地登錄顯示名
zcode identity clear        # 刪除快照，回落顯示脫敏 API key
```

TUI 橫幅與狀態欄顯示的登錄帳號名來自共享憑證庫
（`~/.zcode/v2/credentials.json`）裡加密的 `oauth:<provider>:user_info`
**快照**。該快照只在 OAuth 登錄那一刻寫入，此後沒有任何機制刷新它——在
bigmodel.cn 上改了用戶名後 TUI 會一直顯示舊名，重新 `zcode login` 也無濟於事
（runtime 只保存換發的 API key，不回寫用戶信息快照）。
`zcode identity set` 就是手動同步入口：重寫快照中的 username /
displayName（保留 id / 頭像等其餘字段與憑證庫相鄰條目），新開的 TUI 會話
立即生效。

切換帳號由兩層機制自動處理：

- TUI 橫幅與狀態欄在每次登錄後都會重新讀取身份——切換 Z.AI 帳號後無需
  重啟 TUI 即顯示新名（Z.AI OAuth 登錄流程本身會重寫快照）。
- BigModel OAuth 與 API key 登錄從不回寫快照，這類登錄之後存儲的帳號名
  無法再歸因到當前登錄帳號。當登錄使 provider 的 API key 發生變化時，
  TUI 自動清除舊名、回落顯示脫敏 API key（同帳號重新登錄則保留原名）；
  之後可用 `zcode identity set <名稱>` 重新固定當前帳號的顯示名。

針對 BigModel API key 登錄，還有一種按 key 歸屬、天然免疫帳號切換的
方式：`~/.zcode/cli/bigmodel-users.json`——BigModel 登錄通道專屬的
平鋪 JSON 映射表（API key → 顯示名，有意不放進 custom-provider 文件）：

```json
{
  "<api-key>": "工作帳號",
  "<api-key>": "個人帳號"
}
```

顯示名完全由你決定、自由填寫——用戶名、key 備註名、帳號名或任意你想
貼在這個 key 上的標籤都可以，它只是本地顯示文本。活躍 provider 的 key
命中映射時，橫幅、狀態欄與 `zcode identity` 顯示映射的名字
（*API key \<名字\> (\<脫敏 key\>)* 形式）；未命中的 key 維持脫敏顯示。
由於每個 key 自帶顯示名，切換帳號始終顯示你給當前 key 指定的名字、
無需重新固定。**映射名由 TUI 代為收集**：任何經 BigModel 選項（OAuth 或
粘貼 key）的 `/login` 都會先彈出輸入框收 user name——按 Esc 取消本次
登錄——登錄成功後自動寫入該文件、綁定本次落盤的 key；手工編輯與登錄
收集的條目完全等價、可混用。

## 架構

```text
Node.js 啟動器（配置 / 登錄 / 版本元數據）
  └─ 繼承的 stdin / stdout / stderr
      └─ 官方 zcode.cjs agent runtime
          └─ 本地 @zcode/tui 適配層
              └─ @earendil-works/pi-tui
```

官方的 agent、模型、會話、工具、插件、MCP、憑證存儲與 provider 配置邏輯全部保留
在提取出的 runtime 中。本地包只補齊缺失的終端界面，以及為 Z.AI 註冊的桌面 OAuth
流程提供一條窄的 macOS 回調橋。Node.js 啟動公開的命令，並作為提取出的上游
內核的兼容宿主。官方 runtime 直接掌管原始終端模式、輸入法光標定位與縮放處理；
啟動器不插入第二個 PTY、不中轉終端字節流。

## 功能特性

**編輯與輸入。** 基於 pi-tui 的差分渲染，支持中日韓寬字符的多行編輯器；斜槓命令、
統一的 `@` 工作區 / 插件引用與 `$` Skill 補全；經 ZCode 歷史接口持久化的輸入歷史；
支持 `--no-color` 與 `NO_COLOR`。

**流式輸出與會話。** 來自官方 ZCode 會話事件的流式助手文本；`/mode`、`/model`、
`/resume`、`/plugins` 等上游斜槓命令；可搜索的模型與推理力度選擇器，以及 MCP 與
工作流面板；狀態欄 Shift+Tab 模式循環（`build` → `edit` → `yolo` → `plan`）、
Ctrl+N 切換模型、空輸入 Tab 切換推理力度；回合腳註右側的結構化會話目標狀態；
帶動畫的活動回合计時器（`ZCODE_TUI_REDUCED_MOTION=1` 時退化為靜態）；響應式的
剩餘上下文與會話 token 指標。

**登錄與權限。** `/login` 設置選項與掩碼 API key 輸入；脫敏的會話記錄與歷史；
OAuth 等待態；掛起的 Z.AI 瀏覽器登錄（含終端恢復與可選的 `ZCODE_TUI_LOGIN_CMD`
覆蓋）；啟動橫幅與狀態欄顯示登錄身份（OAuth 賬號用戶名、key 映射名或脫敏
API key——經 `/login` 粘貼的 Coding Plan key 同樣算登錄）；
`/logout` 清除已存的 Z.AI 與 BigModel 登錄憑證（含官方槽位的 API key；
自定義 provider 槽位屬模型訪問配置，保留不動）；交互式工具權限審批對話框。

**附件與富輸出。** Ctrl+V 智能粘貼剪貼板（圖片加為附件、文本直接插入編
輯器），`/paste-image` 專貼圖片，配鍵盤可選的附件行；緊湊的工具執行視圖（路徑、命令、進度、結果與圖片預覽）；父子 Agent 工具樹
（含可恢復的子代理元數據、可展開的 Prompt/Response 詳情）；語法高亮的 Markdown
代碼塊與流式期間穩定的塊渲染；Pierre 風格的內聯 diff（行號、語法高亮、
詞級變更、CJK 換行）；終端原生 Mermaid 預覽（不支持或超大的圖表回退為源碼展示）。

**檢視與導航。** `/diff` 瀏覽當前 Git 變更與逐回合文件變更；`/context` 查看
prompt 組成、緩存與上下文用量；`/status` 查看會話、runtime、目標、MCP 與工作區
詳情；`/activity` 與任務中心（後台狀態、輸出、agent 會話與恢復）；可搜索的會話
記錄導航（逐塊展開、選中塊複製、`n`/`N` 匹配遍歷）；transcript 與編輯器之間
持久化的活動工具、後台任務與打開的計劃。

**轉向、回退與通知。** 活動回合轉向、取消與錯誤上報；雙 Esc 回退（輸入點選擇與
安全的會話 / 工作區作用域）；失焦時的回合完成通知（終端原生 OSC 9 或 BEL，可選
桌面命令）；`/copy`、`/cls`、`/exit`、Ctrl+C 與 Ctrl+D 處理，退出時顯示 token
用量與恢復指引。

## 工作區集成

### 引用工作區文件

在提示詞開頭或空白後輸入 `@` 打開項目文件補全。繼續輸入路徑，用上下鍵選擇候選，
按 Tab 或 Enter 插入。選中目錄後可繼續輸入下一段路徑。

```text
Explain @README.md
Compare @src/index.ts with @"docs/design notes.md"
```

候選來自官方 ZCode runtime，限定在當前工作區內，並排除常見的倉庫元數據與依賴
目錄。含空格的路徑以 `@"..."` 引號形式插入。

### 引用插件

同一個 `@` 選擇器還包含已啟用、無歧義且至少暴露一個 Skill、已連接 MCP 服務器或
Subagent 的插件。插件行以 `@name` 標註其來源市場。選中後插入 runtime 原生的
Markdown 引用：

```text
Use [@browser-use](plugin://browser-use@zcode-plugins-official) to check this page
```

終端編輯器顯示的是 Markdown 源碼，因為沒有桌面版式的內嵌 chip。runtime 會在當前
會話上解析該鏈接，只把該插件的在線能力加為元數據。插件引用不會安裝、啟用、授權
或強制使用任何能力。已禁用、歧義或過期的引用會被 runtime 忽略。

### 調用 Skill

在提示詞開頭或空白後輸入 `$` 打開 Skill 選擇器。繼續輸入名稱，用上下鍵選擇，按
Tab 或 Enter 插入。

```text
$audit review the current changes
Use $browser-use:control-browser to verify the page
```

選擇器使用官方 runtime 的 Skill 目錄，插件 Skill 以限定名插入。提交時，精確匹配
的 `$name` 會被轉換為請求，在執行可見的用戶請求前先經 runtime 的 `Skill` 工具
加載所選 Skill。未知的 `$` 標記保持普通提示詞文本。

當整個插件相關（含其 MCP 服務器或 Subagent）時用 `@plugin`；當必須在任務開始前
加載某個確切 Skill 時用 `$plugin:skill`。

Skill 與自定義命令的發現也可在 TUI 之外通過 runtime 子命令完成，`--json` 供
腳本使用：

```bash
zcode skills list                 # 所有已發現的 skill（含插件限定名）
zcode skills inspect <name>       # 完整描述、來源路徑與元數據
zcode commands list               # 已發現的自定義斜槓命令
zcode commands inspect <name>     # 參數提示與解析後的正文
```

### 活動回合輸入

常規 agent 回合運行期間，按 Enter 將當前文本作為同回合轉向發送。在官方 runtime
到達安全的模型步邊界之前，轉向停留在編輯器旁的等待行，不顯示為已提交的會話歷史。
runtime 確認注入後，消息按其實際位置進入會話記錄，並使用正常的用戶消息 `›`
前綴。`↪` 標記專屬於臨時等待行。

若想讓後續輸入保持可編輯，請在編輯器含文本且補全關閉時按 Tab。輸入進入本地下一
回合隊列，按 FIFO 順序在活動回合正常結束後發出。編輯器為空時按 `Alt+Up` 或
`Shift-Left` 可把最近排隊的輸入移回編輯器。已接受的轉向無法編輯——即使在等待行
仍可見時，它已交給官方 runtime；需要保持可改時請用 Tab。被拒絕或在注入前丟棄的
轉向會回到可編輯的下一回合隊列。

### 圖片附件

按 `Ctrl+V` 從剪貼板粘貼：內容是圖片則加為附件，是文本則直接插入編輯
器。運行 `/paste-image` 則只附加圖片。待發圖片以完整的 `[Image #N]`
標記顯示在編輯器上方。提交提示詞時，這些圖片立即移入該用戶回合，從待發行移除，
不會洩漏到下一個提示詞。

將編輯器光標移到首行行首按 `Up`，或運行 `/attachments`，可聚焦附件行。聚焦時：

- `Left`/`Right` 選擇圖片；
- `Backspace` 或 `Delete` 刪除選中圖片並重新編號；
- `Down`、`Esc`、`Ctrl+C` 或 `Enter` 返回編輯器且不改動其文本。

運行 `/attachments clear` 一次性移除所有待發圖片。`Ctrl+D` 保留終端標準的
空編輯器退出與前向刪除行為。

### 會話回退

編輯器為空且無活動回合時，在 800 ms 內按兩次 `Esc` 打開會話回退選擇器。選擇要
返回的用戶輸入，查看可用的工作區檢查點，然後在可用作用域中選擇：

- **僅會話**：移除之後的會話回合，工作區文件保持不變，並把選中的輸入恢復到編輯器；
- **會話與工作區**：同時恢復安全檢查點內的文件變更；
- **僅工作區**：只恢復安全檢查點內的文件，不改動會話。

只有當官方 ZCode runtime 報告完整的安全檢查點計劃時，作用域選擇器才提供工作區
恢復選項。外部修改的文件不會被覆蓋；Bash 或終端文件變更因沒有可恢復的 ZCode
檢查點而報告為忽略。在作用域選擇器按 `Esc` 返回輸入選擇，再按 `Esc` 關閉回退。

### TUI 檢視與導航

```text
/diff                         瀏覽當前與逐回合的文件變更
/context                      檢視上下文用量與來源組成
/status                       檢視詳細的 runtime 與會話狀態
/activity                     檢視所有活動工具與打開的任務
/tasks                        檢視並管理後台任務
/tasks message <id> <text>    向運行中的後台 agent 發送指引
/tasks resume <id> [text]     恢復已停止或失敗的後台 agent
/tasks stop <id>              停止運行中的後台任務
/search <text>                搜索保留的會話記錄塊
/search next|prev|clear       導航或關閉會話記錄搜索
/transcript latest            選中最新的會話記錄塊
/transcript next|prev|close   導航或離開會話記錄選擇
/copy                         複製選中塊或最新回覆
/cls                          僅清空可見會話記錄
```

`/cls` 只清空 TUI 顯示、不觸碰會話。runtime 自帶的 `/clear` 是 `/new` 的別名、
會開啟新會話，因此原樣轉發給 runtime。

任務中心把自主任務的輸出留在前台會話之外。主會話只收到緊湊的完成、回覆與失敗
通知；選中任務可查看其輸出與任務範圍的活動。Agent 任務運行期間可接收消息，官方
runtime 收到消息時會從保存的子會話恢復終端 agent。Bash 任務提供可審查的重跑請求，
因為停止的進程無法從執行檢查點繼續。保存的最終任務輸出在 TUI 重啟後仍可用，大
文件截斷保留最新 64 KiB。工作流任務打開其現有運行面板與控制。

一秒內完成的 Agent 調用保持為普通前台工具，結果可直接進入當前回覆。更長的
Agent 調用自動移入任務中心，釋放前台回合、繼續後台運行。可將 `subagents.autoBackgroundMs`
設為其它正時長，或設為 `0` 禁用自動後台化。顯式的 `run_in_background: true`
仍會立即後台化 Agent。

編輯器為空時，`Alt+Up` 與 `Alt-Down` 導航選中的會話記錄塊。`Ctrl+O` 僅展開
選中 / 搜索命中的塊；無選中時切換所有可展開內容。會話記錄搜索期間，`n` 與 `N`
移動到下一個 / 上一個匹配。`Left`/`Right`（或 `PageUp` 與 `PageDown`）對超大的
選中塊分頁，不必一次渲染整條消息。`Esc` 退出搜索或會話記錄導航。

## 插件管理

內置插件（Browser Use、文檔 skills、Skill Creator 等）由官方 runtime 播種。
既有已裝插件命令繼續直接使用 runtime：

```bash
zcode plugins list --json
zcode plugins enable <plugin-id>
zcode plugins disable <plugin-id>
zcode plugins uninstall <plugin-id> --force
```

Node.js 啟動器通過調用 runtime 公開的 `app-server` 協議補充市場操作；不 patch、不
重新實現插件子系統。運行 `zcode plugins --help` 查看完整命令列表。典型的第三方
安裝流程：

```bash
zcode plugins discover
zcode plugins marketplace add owner/repository --dry-run
zcode plugins marketplace add owner/repository
zcode plugins describe plugin-name@marketplace-name
zcode plugins install plugin-name@marketplace-name --dry-run
zcode plugins install plugin-name@marketplace-name
```

市場添加與安裝會先校驗、展示插件的組件與依賴閉包並請求確認。`--yes` 僅用於有意的
非交互執行，`--json` 輸出結構化數據，`--scope user|workspace` 選擇安裝範圍。代理
後的市場 Git 訪問使用 `ZCODE_HTTP_PROXY`。

帶配置的插件可從 JSON 文件加載選項，避免在進程參數列表中暴露取值：

```bash
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json --dry-run
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json
```

含密鑰的文件請保密。安裝、更新、配置、啟用與禁用的變更對新會話生效。

### CLI 中的 Browser Use

啟動器默認為 TUI、`--prompt`、`--print` 與 `--target` 會話啟用 CLI 託管的無頭
Chromium 後端。這使得已啟用的 `browser-use` 插件無需額外啟動參數即可在常規
`zcode` 命令中使用：

```bash
zcode
zcode --prompt \
  'Use $browser-use:control-browser to inspect https://example.com'
```

顯式的 `--browser-use=headless` 形式仍受支持，包括需要手動指定 Chromium 時的
`--browser-executable <path>`。託管後端仍需可用的本地 Chrome/Chromium 可執行
文件；自動發現失敗時，請用 `--browser-executable` 傳入絕對路徑。啟動器絕不會向
`plugins`、`skills`、`doctor`、`app-server` 等管理命令注入 Browser Use。既有
會話須重啟後該後端才可用。

託管瀏覽器是一次性的無頭上下文。它不复用 ZCode 桌面版內置瀏覽器的用戶資料、
cookie 或登錄態，因此公共搜索引擎可能更頻繁地斷開連接或要求驗證，在 VPN、代理或
共享出口 IP 下尤甚。`--browser-executable` 只選擇 Chrome/Chromium 二進制，不會
讓瀏覽器變有頭或持久化。一般事實查證時，若有搜索能力可用，避免強制使用
Browser Use；儘量使用直達頁面 URL，交互式登錄或驗證流程請用桌面版內置瀏覽器。

## 環境需求

- Node.js 22.19 或更高；
- macOS、Linux 或 Windows（x64 與 ARM64）。

Z.AI 瀏覽器 OAuth 目前僅支持 macOS，因為註冊的 provider 回調是
`zcode://zai-auth/callback`；API key 與自定義 provider 接入在所有受支持平台上
均可用。

當理想的 Node.js 可執行文件不在 `PATH` 上時，設置 `ZCODE_NODE=/absolute/path/to/node`。

## 配置

ZCode 從 `~/.zcode/cli/config.json`（Windows 上為
`%USERPROFILE%\.zcode\cli\config.json`）讀取配置，工作目錄下的 `zcode.json` 或
`.zcode/config.json` 可做項目級覆蓋。既有文件不會被替換。

支持三種模型接入方式：Z.AI OAuth（僅 macOS）、Z.AI/BigModel Coding Plan
API key、或帶自定義 provider 的直連 API key。詳細的設置步驟、重試 / 超時、主題
與回合完成通知見[配置文檔](./docs/CONFIGURATION.md)。

另有扁平文件方式：把帶註釋的 `custom-provider.env.example` 模板複製為
`~/.zcode/cli/custom-provider.env` 並填入 API key 與模型 ID——無需登錄或手改
JSON。該文件專門服務**未登錄**場景：未登錄（登錄指 OAuth 賬號授權，或經
`/login` 粘貼的 key；僅寫進本文件的 key 不算）時每次啟動先把它同步進 config.json
再拉起 runtime（同步結果寫入獨立的 `env-<provider-id>` 槽位），身份欄顯示
「Not signed in」；`/login` 登錄後模型選擇與身份顯示自動切到登錄身份，
`/logout` 登出後又自動回到這份文件——全程無需手動刪除或恢復。備用 key 用編號
變量（`ZCODE_API_KEY_2`、`ZCODE_API_KEY_3`……每變量一把 key）：多於一把時
zcode 會啟用本地回環容災代理，某把 key 的請求被拒（401/403/429、5xx、
連接失敗）時自動換下一把重試，詳見[配置文檔](./docs/CONFIGURATION.md)。

## 本地開發

安裝依賴並從本地 ZCode Desktop 安裝實時同步 TypeScript 啟動客戶端：

```bash
bun install
bun run dev
```

運行全部驗證層：

```bash
bun run typecheck
bun test
bun run check
bun run check:tui
```

OAuth 接入、發布工作流細節、CI 與完整開發指南見[開發文檔](./docs/DEVELOPMENT.md)；
僅供維護者使用的發布與發布流程見[發布文檔](./docs/RELEASING.md)。

## 參與貢獻

歡迎在 [github.com/xhqing/zcode-cli](https://github.com/xhqing/zcode-cli) 提交
issue 與 pull request。較大改動請先開 issue 討論。本地環境搭建與驗證命令見
[開發文檔](./docs/DEVELOPMENT.md)，發布流程見[發布文檔](./docs/RELEASING.md)。

## 版權與署名

本項目以 [MIT 許可證](./LICENSE.md) 發布。

- 版權所有 (c) 2026 zcode-app-cli contributors（上游項目）。
- 版權所有 (c) 2026 All Contributors。
- 署名方式：複用或再分發本項目時，請保留版權聲明與許可證文本，並以鏈接回項目倉庫的方式註明來源。
- 項目地址：https://github.com/xhqing/zcode-cli
