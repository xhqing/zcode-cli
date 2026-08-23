# ZCode CLI

<div align="center">

![ZCode CLI](./assets/logo.svg)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/Version-3.8.1--17-blue.svg)](./CHANGELOG.md)
[![Type](https://img.shields.io/badge/Type-CLI_Tool-blue.svg)]()

[English](README.md) | [简体中文](README_cn.md) | 繁體中文

</div>

非官方的 ZCode 終端用戶端，直接執行 ZCode Desktop 附帶的官方 agent runtime。

本專案擷取上游 `resources/glm` runtime，注入基於
[`@earendil-works/pi-tui`](https://github.com/earendil-works/pi/tree/main/packages/tui)
的本機 `@zcode/tui` 實作，並以 Node.js 子程序直接繼承使用者終端的方式啟動。

本專案與 Z.ai 無隸屬關係、也未獲其背書。ZCode 及其附帶的 runtime 仍受上游條款約束；
發布 npm 套件前請先確認你有權再散布擷取出的 runtime。

![ZCode CLI TUI demo](./docs/assets/demo.svg)

## 快速開始

```bash
npm install -g zcode-app-cli@latest
zcode
```

首次啟動時，ZCode 會建立 `~/.zcode/cli/config.json`（Windows 上為
`%USERPROFILE%\.zcode\cli\config.json`），寫入免憑證的預設設定，並在 TUI 中開啟
設定精靈。精靈會依次引導[設定](./docs/CONFIGURATION.md)仲介紹的三種模型接入方式；
若本機裝有 ZCode 桌面版，還可匯入桌面版的 provider 設定（憑證仍需重新登入，類似
瀏覽器匯入使用者設定檔）。隨時可用 `/setup` 重新開啟精靈；按 Esc 略過。

## 目錄

- [快速開始](#快速開始)
- [安裝與更新](#安裝與更新)
- [架構](#架構)
- [功能特性](#功能特性)
- [工作區整合](#工作區整合)
- [外掛管理](#外掛管理)
- [環境需求](#環境需求)
- [設定](#設定)
- [本機開發](#本機開發)
- [參與貢獻](#參與貢獻)
- [版權與署名](#版權與署名)

## 安裝與更新

```bash
npm install -g zcode-app-cli@latest
# 或
bun add -g zcode-app-cli@latest
```

npm 套件名為 `zcode-app-cli`（npm 上的 `zcode-cli` 名字已被無關套件占用），
專案展示名為 **ZCode CLI**、指令為 `zcode`。固定使用 `@latest` 是刻意為之：
與 App 對齊的版本號採用 `3.3.5-2` 這類帶 SemVer 預發布段的格式，`latest`
標籤始終指向最新驗證過的「App 版本 + 建置號」發布。

已安裝的使用者升級只需執行：

```bash
zcode --update
```

該指令經 `gh` CLI 從 GitHub Release 解析最新版本，下載 Release 上掛的
`zcode-cli-<版本>.tgz` asset 後全域重灌。GitHub Release 是唯一的更新
管道——每個 Release 都附帶該 tarball asset。

互動式啟動時，每 20 小時至多檢查一次 npm `latest` 標籤（按已安裝版本計），有新
版本時以非阻塞的更新卡片提示，附精確的更新指令與 release notes 連結。CI 環境
自動略過檢查。設定 `ZCODE_DISABLE_UPDATE_CHECK=1` 或 `NO_UPDATE_NOTIFIER=1`
可關閉。

正常安裝只需 Node.js，無原生 PTY 擴充、無 postinstall 建置步驟。

## 架構

```text
Node.js npm 啟動器（設定 / 登入 / 版本詮釋資料）
  └─ 繼承的 stdin / stdout / stderr
      └─ 官方 zcode.cjs agent runtime
          └─ 本機 @zcode/tui 適配層
              └─ @earendil-works/pi-tui
```

官方的 agent、模型、會話、工具、外掛、MCP、憑證儲存與 provider 設定邏輯全部保留
在擷取出的 runtime 中。本機套件只補齊缺失的終端介面，以及為 Z.AI 註冊的桌面 OAuth
流程提供一條窄的 macOS 回呼橋。Node.js 啟動公開的 npm 指令，並作為擷取出的上游
核心的相容宿主。官方 runtime 直接掌管原始終端模式、輸入法游標定位與縮放處理；
啟動器不插入第二個 PTY、不中轉終端位元組流。

## 功能特性

**編輯與輸入。** 基於 pi-tui 的差分渲染，支援中日韓寬字元的多行編輯器；斜線指令、
統一的 `@` 工作區 / 外掛參照與 `$` Skill 補全；經 ZCode 歷史介面持久化的輸入歷史；
支援 `--no-color` 與 `NO_COLOR`。

**串流輸出與會話。** 來自官方 ZCode 會話事件的串流助手文字；`/mode`、`/model`、
`/resume`、`/plugins` 等上游斜線指令；可搜尋的模型與推理力度選擇器，以及 MCP 與
工作流面板；狀態列 Shift+Tab 模式循環（`build` → `edit` → `yolo` → `plan`）、
Ctrl+N 切換模型、空輸入 Tab 切換推理力度；回合頁尾右側的結構化會話目標狀態；
帶動畫的活動回合计時器（`ZCODE_TUI_REDUCED_MOTION=1` 時退化為靜態）；響應式的
剩餘上下文與會話 token 指標。

**登入與權限。** `/login` 設定選項與遮罩 API key 輸入；去敏化的會話記錄與歷史；
OAuth 等待態；擱置的 Z.AI 瀏覽器登入（含終端恢復與可選的 `ZCODE_TUI_LOGIN_CMD`
覆寫）；互動式工具權限核准對話框。

**附件與富輸出。** Ctrl+V 或 `/paste-image` 貼上剪貼簿圖片附件，配鍵盤可選的附件
列；緊湊的工具執行視圖（路徑、指令、進度、結果與圖片預覽）；父子 Agent 工具樹
（含可恢復的子代理詮釋資料、可展開的 Prompt/Response 詳情）；語法高亮的 Markdown
程式碼區塊與串流期間穩定的區塊渲染；Pierre 風格的行內 diff（行號、語法高亮、
詞級變更、CJK 換行）；終端原生 Mermaid 預覽（不支援或超大的圖表回退為原始碼展示）。

**檢視與導覽。** `/diff` 瀏覽目前 Git 變更與逐回合檔案變更；`/context` 檢視
prompt 組成、快取與上下文用量；`/status` 檢視會話、runtime、目標、MCP 與工作區
詳情；`/activity` 與任務中心（背景狀態、輸出、agent 會話與恢復）；可搜尋的會話
記錄導覽（逐塊展開、選中塊複製、`n`/`N` 匹配遍歷）；transcript 與編輯器之間
持久化的活動工具、背景任務與開啟的計畫。

**轉向、回退與通知。** 活動回合轉向、取消與錯誤上報；雙 Esc 回退（輸入點選擇與
安全的會話 / 工作區作用域）；失焦時的回合完成通知（終端原生 OSC 9 或 BEL，可選
桌面指令）；`/copy`、`/cls`、`/exit`、Ctrl+C 與 Ctrl+D 處理，離開時顯示 token
用量與恢復指引。

## 工作區整合

### 參照工作區檔案

在提示詞開頭或空白後輸入 `@` 開啟專案檔案補全。繼續輸入路徑，用上下鍵選擇候選，
按 Tab 或 Enter 插入。選中目錄後可繼續輸入下一段路徑。

```text
Explain @README.md
Compare @src/index.ts with @"docs/design notes.md"
```

候選來自官方 ZCode runtime，限定在目前工作區內，並排除常見的儲存庫詮釋資料與依賴
目錄。含空格的路徑以 `@"..."` 引號形式插入。

### 參照外掛

同一個 `@` 選擇器還包含已啟用、無歧義且至少暴露一個 Skill、已連線 MCP 伺服器或
Subagent 的外掛。外掛行以 `@name` 標註其來源市集。選中後插入 runtime 原生的
Markdown 參照：

```text
Use [@browser-use](plugin://browser-use@zcode-plugins-official) to check this page
```

終端編輯器顯示的是 Markdown 原始碼，因為沒有桌面版式的內嵌 chip。runtime 會在目前
會話上解析該連結，只把該外掛的線上能力加為詮釋資料。外掛參照不會安裝、啟用、授權
或強制使用任何能力。已停用、歧義或過期的參照會被 runtime 忽略。

### 呼叫 Skill

在提示詞開頭或空白後輸入 `$` 開啟 Skill 選擇器。繼續輸入名稱，用上下鍵選擇，按
Tab 或 Enter 插入。

```text
$audit review the current changes
Use $browser-use:control-browser to verify the page
```

選擇器使用官方 runtime 的 Skill 目錄，外掛 Skill 以限定名插入。送出時，精確匹配
的 `$name` 會被轉換為請求，在執行可見的使用者請求前先經 runtime 的 `Skill` 工具
載入所選 Skill。未知的 `$` 標記保持普通提示詞文字。

當整個外掛相關（含其 MCP 伺服器或 Subagent）時用 `@plugin`；當必須在任務開始前
載入某個確切 Skill 時用 `$plugin:skill`。

Skill 與自訂指令的發現也可在 TUI 之外透過 runtime 子指令完成，`--json` 供
腳本使用：

```bash
zcode skills list                 # 所有已發現的 skill（含外掛限定名）
zcode skills inspect <name>       # 完整描述、來源路徑與詮釋資料
zcode commands list               # 已發現的自訂斜線指令
zcode commands inspect <name>     # 參數提示與解析後的正文
```

### 活動回合輸入

常規 agent 回合執行期間，按 Enter 將目前文字作為同回合轉向送出。在官方 runtime
到達安全的模型步邊界之前，轉向停留在編輯器旁的等待列，不顯示為已送出的會話歷史。
runtime 確認注入後，訊息按其實際位置進入會話記錄，並使用正常的使用者訊息 `›`
前綴。`↪` 標記專屬於臨時等待列。

若想讓後續輸入保持可編輯，請在編輯器含文字且補全關閉時按 Tab。輸入進入本機下一
回合佇列，按 FIFO 順序在活動回合正常結束後發出。編輯器為空時按 `Alt+Up` 或
`Shift-Left` 可把最近排隊的輸入移回編輯器。已接受的轉向無法編輯——即使在等待列
仍可見時，它已交給官方 runtime；需要保持可改時請用 Tab。被拒絕或在注入前丟棄的
轉向會回到可編輯的下一回合佇列。

### 圖片附件

按 `Ctrl+V` 或執行 `/paste-image` 從剪貼簿附加圖片。待發圖片以完整的 `[Image #N]`
標記顯示在編輯器上方。送出提示詞時，這些圖片立即移入該使用者回合，從待發列移除，
不會洩漏到下一個提示詞。

將編輯器游標移到首行行首按 `Up`，或執行 `/attachments`，可聚焦附件列。聚焦時：

- `Left`/`Right` 選擇圖片；
- `Backspace` 或 `Delete` 刪除選中圖片並重新編號；
- `Down`、`Esc`、`Ctrl+C` 或 `Enter` 返回編輯器且不改動其文字。

執行 `/attachments clear` 一次性移除所有待發圖片。`Ctrl+D` 保留終端標準的
空編輯器離開與向前刪除行為。

### 會話回退

編輯器為空且無活動回合時，在 800 ms 內按兩次 `Esc` 開啟會話回退選擇器。選擇要
返回的使用者輸入，檢視可用的工作區檢查點，然後在可用作用域中選擇：

- **僅會話**：移除之後的會話回合，工作區檔案保持不變，並把選中的輸入恢復到編輯器；
- **會話與工作區**：同時恢復安全檢查點內的檔案變更；
- **僅工作區**：只恢復安全檢查點內的檔案，不改動會話。

只有當官方 ZCode runtime 報告完整的安全檢查點計畫時，作用域選擇器才提供工作區
恢復選項。外部修改的檔案不會被覆寫；Bash 或終端檔案變更因沒有可恢復的 ZCode
檢查點而報告為忽略。在作用域選擇器按 `Esc` 返回輸入選擇，再按 `Esc` 關閉回退。

### TUI 檢視與導覽

```text
/diff                         瀏覽目前與逐回合的檔案變更
/context                      檢視上下文用量與來源組成
/status                       檢視詳細的 runtime 與會話狀態
/activity                     檢視所有活動工具與開啟的任務
/tasks                        檢視並管理背景任務
/tasks message <id> <text>    向執行中的背景 agent 傳送指引
/tasks resume <id> [text]     恢復已停止或失敗的背景 agent
/tasks stop <id>              停止執行中的背景任務
/search <text>                搜尋保留的會話記錄塊
/search next|prev|clear       導覽或關閉會話記錄搜尋
/transcript latest            選中最新的會話記錄塊
/transcript next|prev|close   導覽或離開會話記錄選擇
/copy                         複製選中塊或最新回覆
/cls                          僅清空可見會話記錄
```

`/cls` 只清空 TUI 顯示、不觸碰會話。runtime 自帶的 `/clear` 是 `/new` 的別名、
會開啟新會話，因此原樣轉發給 runtime。

任務中心把自主任務的輸出留在前景會話之外。主會話只收到緊湊的完成、回覆與失敗
通知；選中任務可檢視其輸出與任務範圍的活動。Agent 任務執行期間可接收訊息，官方
runtime 收到訊息時會從儲存的子會話恢復終端 agent。Bash 任務提供可審查的重跑請求，
因為停止的程序無法從執行檢查點繼續。儲存的最終任務輸出在 TUI 重啟後仍可用，大
檔案截斷保留最新 64 KiB。工作流任務開啟其現有執行面板與控制。

一秒內完成的 Agent 呼叫保持為普通前景工具，結果可直接進入目前回覆。更長的
Agent 呼叫自動移入任務中心，釋放前景回合、繼續背景執行。可將 `subagents.autoBackgroundMs`
設為其它正時長，或設為 `0` 停用自動背景化。顯式的 `run_in_background: true`
仍會立即背景化 Agent。

編輯器為空時，`Alt+Up` 與 `Alt-Down` 導覽選中的會話記錄塊。`Ctrl+O` 僅展開
選中 / 搜尋命中的塊；無選中時切換所有可展開內容。會話記錄搜尋期間，`n` 與 `N`
移動到下一個 / 上一個匹配。`Left`/`Right`（或 `PageUp` 與 `PageDown`）對超大的
選中塊分頁，不必一次渲染整條訊息。`Esc` 退出搜尋或會話記錄導覽。

## 外掛管理

內建外掛（Browser Use、文件 skills、Skill Creator 等）由官方 runtime 播種。
既有已裝外掛指令繼續直接使用 runtime：

```bash
zcode plugins list --json
zcode plugins enable <plugin-id>
zcode plugins disable <plugin-id>
zcode plugins uninstall <plugin-id> --force
```

npm 啟動器透過呼叫 runtime 公開的 `app-server` 協定補充市集操作；不 patch、不
重新實作外掛子系統。執行 `zcode plugins --help` 檢視完整指令清單。典型的第三方
安裝流程：

```bash
zcode plugins discover
zcode plugins marketplace add owner/repository --dry-run
zcode plugins marketplace add owner/repository
zcode plugins describe plugin-name@marketplace-name
zcode plugins install plugin-name@marketplace-name --dry-run
zcode plugins install plugin-name@marketplace-name
```

市集新增與安裝會先校驗、展示外掛的元件與依賴閉包並請求確認。`--yes` 僅用於有意的
非互動執行，`--json` 輸出結構化資料，`--scope user|workspace` 選擇安裝範圍。代理
後的市集 Git 存取使用 `ZCODE_HTTP_PROXY`。

帶設定的外掛可從 JSON 檔案載入選項，避免在程序參數列表中暴露取值：

```bash
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json --dry-run
zcode plugins configure plugin-name@marketplace-name \
  --options-file ./plugin-options.json
```

含密鑰的檔案請保密。安裝、更新、設定、啟用與停用的變更對新會話生效。

### CLI 中的 Browser Use

啟動器預設為 TUI、`--prompt`、`--print` 與 `--target` 會話啟用 CLI 託管的無頭
Chromium 後端。這使得已啟用的 `browser-use` 外掛無需額外啟動參數即可在常規
`zcode` 指令中使用：

```bash
zcode
zcode --prompt \
  'Use $browser-use:control-browser to inspect https://example.com'
```

顯式的 `--browser-use=headless` 形式仍受支援，包括需要手動指定 Chromium 時的
`--browser-executable <path>`。託管後端仍需可用的本機 Chrome/Chromium 可執行
檔案；自動發現失敗時，請用 `--browser-executable` 傳入絕對路徑。啟動器絕不會向
`plugins`、`skills`、`doctor`、`app-server` 等管理指令注入 Browser Use。既有
會話須重啟後該後端才可用。

託管瀏覽器是一次性的無頭情境。它不复用 ZCode 桌面版內建瀏覽器的使用者設定檔、
cookie 或登入態，因此公共搜尋引擎可能更頻繁地斷開連線或要求驗證，在 VPN、代理或
共享出口 IP 下尤甚。`--browser-executable` 只選擇 Chrome/Chromium 二進位，不會
讓瀏覽器變有頭或持久化。一般事實查證時，若有搜尋能力可用，避免強制使用
Browser Use；儘量使用直達頁面 URL，互動式登入或驗證流程請用桌面版內建瀏覽器。

## 環境需求

- Node.js 22.19 或更高；
- macOS、Linux 或 Windows（x64 與 ARM64）。

Z.AI 瀏覽器 OAuth 目前僅支援 macOS，因為註冊的 provider 回呼是
`zcode://zai-auth/callback`；API key 與自訂 provider 接入在所有受支援平台上
均可用。

當理想的 Node.js 可執行檔案不在 `PATH` 上時，設定 `ZCODE_NODE=/absolute/path/to/node`。

## 設定

ZCode 從 `~/.zcode/cli/config.json`（Windows 上為
`%USERPROFILE%\.zcode\cli\config.json`）讀取設定，工作目錄下的 `zcode.json` 或
`.zcode/config.json` 可做專案級覆寫。既有檔案不會被替換。

支援三種模型接入方式：Z.AI OAuth（僅 macOS）、Z.AI/BigModel Coding Plan
API key、或帶自訂 provider 的直連 API key。詳細的設定步驟、重試 / 逾時、主題
與回合完成通知見[設定文件](./docs/CONFIGURATION.md)。

另有扁平檔案方式：把帶註解的 `.env.example` 範本複製為 `~/.zcode/cli/.env`
並填入 API key 與模型 ID——每次啟動時 zcode 會先把它同步進 config.json 再拉起
runtime，無需登入或手改 JSON。

## 本機開發

安裝依賴並從本機 ZCode Desktop 安裝即時同步 TypeScript 啟動用戶端：

```bash
bun install
bun run dev
```

執行全部驗證層：

```bash
bun run typecheck
bun test
bun run check
bun run check:tui
```

OAuth 接入、發布工作流細節、CI 與完整開發指南見[開發文件](./docs/DEVELOPMENT.md)；
僅供維護者使用的發布與發布流程見[發布文件](./docs/RELEASING.md)。

## 參與貢獻

歡迎在 [github.com/xhqing/zcode-cli](https://github.com/xhqing/zcode-cli) 提交
issue 與 pull request。較大改動請先開 issue 討論。本機環境搭建與驗證指令見
[開發文件](./docs/DEVELOPMENT.md)，發布流程見[發布文件](./docs/RELEASING.md)。

## 版權與署名

本專案以 [MIT 授權條款](./LICENSE.md) 發布。

- 版權所有 (c) 2026 All Contributors。
- 署名方式：複用或再散布本專案時，請保留版權聲明與授權條款文字，並以連結回專案儲存庫的方式註明來源。
- 專案地址：https://github.com/xhqing/zcode-cli
