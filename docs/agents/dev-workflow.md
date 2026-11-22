# 開發流程

## 指令

腳本定義以 `package.json` 為準，PR 全套檢查以 `.github/workflows/ci.yml` 的 `verify` job 為準：

- **邊做邊驗**：`bun run typecheck`、`bun run lint`、`bun run format:check`，以及單跑測試 `bun test <測試檔>`。
- **結束前全套**：`bun run check && bun test`（依序跑完 `oxlint`、`oxfmt --check`、`tsc --noEmit` 與全套 `bun test`）。
- **macOS 桌面 app 打包**：動到 `app/` 或內嵌客戶端程式時，另外跑 `bun run app:build` 確認產出 `dist/app/bun-darwin-<arch>/issue-map.app`。

## 分支、commit 與合併

- **分支命名**：採 `<開分支的人>/<type>/<topic>`（例如 `gunter/feat/branch-map`）；未帶個人前綴的 `<type>/<topic>`（例如 `fix/edge-cases-and-guards`）亦可，不混用其他結構。
- **Commit 格式**：使用 Conventional Commits 配繁體中文描述（例如 `fix(map): ...`、`feat(app): ...`），供 `.github/workflows/release.yml` 的 `release-please` 判斷版號推進。
- **跟上主線與開 PR**：`main` 啟用嚴格狀態檢查，落後 `main` 的分支無法合併，開 PR 與合併前須 rebase 至最新 `main`。推送後以 `git push -u origin <分支>` 與 `gh pr create --base main --head <分支> --title "..." --body-file <檔>` 建立 PR，標題與正文依 `.github/pull_request_template.md` 填寫（標題寫一句話描述改動且不加 `feat:`／`fix:` 前綴）。
- **合併方式與權限**：本 repo 只允許 merge commit（`gh pr merge --merge`），必過檢查為 `Lint / Format / Type Check / Tests`，且須先解決所有 review thread（必要核准數為 0）。非 `release-please` 的 release PR 在 CI 全綠且無未解討論時，允許 `rd`／autopilot 直接以 `gh pr merge --merge` 合併（不在 repo 設 `.claude/settings.json` 白名單）。
- **合併後發生什麼與收尾**：一般 PR 合併進 `main` 不直接發版，而是由 `.github/workflows/release.yml` 的 `release-please` 累積 commits 並更新 release PR；僅當該 release PR 合併時才會自動打 tag 與 `npm publish`。本機收尾時切回 `main` 拉取最新狀態並刪除已合併分支；若合併的內容涉及打包，依需要重跑 `bun run app:build`。

## 畫面

- **畫面路徑**：`src/issue-map.html`、`src/issue-map-view.ts`、`src/issue-map-page.ts`、`app/pages.ts`。改動這些檔案時由 `rd` 派 `uiux` 審查。
- **共用樣式與外觀基調**：不依賴第三方元件庫，色票、字型與間距定義在 `src/issue-map.html` 與 `app/pages.ts` 的 `:root` CSS 自訂屬性（淺色 `--paper: #f4f6f7`／`--card: #ffffff`，深色 `--paper: #11151a`／`--card: #181d24`），改動須保持兩處 token 一致。
- **斷點與深淺色**：響應式斷點為 `@media (max-width: 720px)`（單欄排版）；深色模式跟隨 `@media (prefers-color-scheme: dark)`。
- **點擊範圍下限**：桌面端操作按鈕與分頁維持至少 `28px` 可點高度，窄螢幕（`< 720px`）可點項目至少 `44px`。
- **要量的寬度、配色與順序**：桌機 `1280px`（對齊 `app/main.ts` 視窗寬）與手機 `375px`（跨 `720px` 斷點），兩種寬度皆量淺色與深色；量不完時依「地圖頁 → 桌面 app 首頁／錯誤頁」順序優先。
- **起服務與截圖**：地圖頁可跑 `bun run issue-map` 產出 `dist/issue-map.html` 直接以瀏覽器開啟，或跑 `ISSUE_MAP_PORT=4747 bun run issue-map:serve` 連 `http://127.0.0.1:4747/`；桌面 app 首頁／錯誤頁跑 `bun run app -- --headless --port 47474 --data-dir <暫存目錄>` 連 `http://127.0.0.1:47474/`。服務就緒後用 `agent-browser` 分別切換寬度（`1280`／`375`）與配色（`light`／`dark`）量測尺寸與對齊並截圖存至 scratch。

## 實機驗收

- **觸發條件**：改動觸及 CLI 啟動（`src/issue-map-serve.ts`、`src/issue-map.ts`）、本機 HTTP server（`app/server.ts`、`app/pages.ts`）或打包與原生視窗橋接（`app/main.ts`、`app/build.ts`、`app/macos-*.ts`）時，合併前必由 `qa` 執行實機驗收。
- **執行範圍與安全邊界**：CLI 端實測 `bun run issue-map` 產出檔案與 `bun run issue-map:serve`（指定測試用 `ISSUE_MAP_PORT`）實際回應；app 端以 `bun run app -- --headless --data-dir <暫存目錄>` 實測 `/open`、`/r/<owner>/<repo>`、`/clone-repo` 流程，只讀寫測試用暫存目錄，不動使用者 `~/.config/issue-map` 與遠端 GitHub 狀態；觸及 `app/build.ts` 或 macOS 原生模組時須實際跑過 `bun run app:build`。
- **驗收輸出**：將實測步驟、指令輸出與暫存環境清理結果回報給 `rd` 寫入 PR 的「## 驗證」節。
