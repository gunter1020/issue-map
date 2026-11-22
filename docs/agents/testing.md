# 測試

## 六條門檻

1. **說得出它防止哪一個故障，才寫。** 一句話講清楚「什麼情況下會壞、壞了誰受害」。只講得出「驗證有傳進去」「驗證有被呼叫」的不寫。兩支抓得到真缺陷，勝過七支證明程式碼長成現在的樣子。
2. **不測接線。** 參數從 A 傳到 B、函式回傳自己的字面值、mock 拋的例外被原樣接住，都是同義反覆，型別檢查與 code review 已經擋。不為了覆蓋率隔離無狀態輔助函式。
3. **不測不是我們寫的東西。** 標準函式庫、Bun／TypeScript 內建行為、`webview-bun` 原生函式庫本身、純說明文字的渲染排版。
4. **行為導向、重構友善。** 只驗公開契約與可觀察行為。重構內部、升級相依套件、微調文案都不該讓測試變紅。
5. **判準必須被缺陷打紅，而且只紅它自己。** 改壞它宣稱要守的那一個行為，確認它會紅、其他測試不會。讀程式碼判斷不出來；做法見下一節。
6. **違反上面任一條，必須換到更有價值的另一條。** 在該測試的 docstring 寫明放棄什麼、換到什麼。

## 第 5 條：反向驗證怎麼做

把測試宣稱要擋的缺陷放進產品碼，看它會不會紅。只在寫新的守門測試時做一次。

1. 從 docstring 取出它守的那一個行為。講不出「壞了會怎樣」的照第 1 條刪掉。
2. 到產品碼找直接控制那個行為的地方。找不到，代表判準指向的是形狀不是行為。
3. 注入最小缺陷：一個值、一個比較符號、一個分支。
4. 單獨跑回答「會不會紅」，全套跑回答「是不是只紅它自己」。兩者對不上時先懷疑暫存目錄、git fixture、本機 port 或 `setTimeout` 計時這類跨測試資源，波及範圍裡與缺陷無關的那幾支單獨重跑確認。
5. 判讀（見下表）。
6. 還原，並確認檔案逐位元相同。

| 結果                   | 意義                         | 處置             |
| ---------------------- | ---------------------------- | ---------------- |
| 沒紅                   | 空殼。判準沒打到它宣稱的行為 | 重寫判準，或刪掉 |
| 紅了，波及範圍解釋得通 | 通過                         | 留著             |
| 紅一片且多數與缺陷無關 | 判準沒指向特定行為           | 拆細             |

缺陷的真實症狀就是啟動即失敗時，整套在載入階段爆掉不算第三種。

### 這個 repo 的指令

- 單跑與全套測試指令見 `dev-workflow.md`〈指令〉。
- **突變測試工具**：`bun run mutate <原始碼檔> [測試檔...]`（見 `tools/mutate.ts`，自動逐行注入保型別突變、過 `tsc --noEmit` 並於結束或收到 `SIGINT`/`SIGTERM` 時還原原檔）。
- 突變算子打不到目標缺陷時（例如字串處理或正規表達式），才手工注入最小缺陷，跑完後立即以 `git checkout -- <檔>` 還原並用 `git diff` 確認無殘留。

## 測試分層

一支測試放在**看得到那個故障的最便宜那一層**。

- **純推導與靜態渲染層**：不碰 `gh`、不碰 git、不開網路，以假快照或假 `RawIssue` 測狀態機、分群、排版、GraphQL 查詢組裝與分頁、HTML／SVG 輸出、loopback Host 檢查與前端輔助函式（`tests/issue-map-status.test.ts`、`tests/issue-map-groups.test.ts`、`tests/issue-map-layout.test.ts`、`tests/issue-map-query.test.ts`、`tests/issue-map-snapshot.test.ts`、`tests/issue-map-view.test.ts`、`tests/issue-map-loopback.test.ts`、`tests/issue-map-page.test.ts`）。
- **本機 git 與檔案儲存層**：在系統暫存目錄建真實 git repo（`tests/git-fixture.ts`）測分支領先落後計算與最近清單 JSON 讀寫降級（`tests/issue-map-git.test.ts`、`tests/app-repos.test.ts`）。
- **本機 HTTP server 層**：起真實 loopback `Bun.serve`，以假 `DrawMap` 替換 `gh` 抓取，測路由、導向、403 Host 閘門與同 repo 併發共用（`tests/app-server.test.ts`）。
- **打包相容層**：讀取實際安裝的 `webview-bun/src/ffi.ts` 測 `patchWebviewLoader` 標記替換，確保 CI 在 Linux 也能攔住相依改版破壞（`tests/app-build.test.ts`）。
- **只有實機看得到的故障**：真實 `gh api graphql` 回應與速率限制、macOS WebView 原生視窗／`NSOpenPanel`／選單列、完整 `.app` 簽章與啟動，交給 `dev-workflow.md`〈實機驗收〉由 `qa` 執行。

## docstring 寫什麼

第 1 條的「防哪一個故障」、第 6 條的取捨與反向驗證的結論都寫在該測試的 docstring。反向驗證只寫一句結論：注入了什麼、紅了哪幾支，例如「`src/issue-map-model.ts` 判斷範圍那一行的 `=== 0` 換成 `!==`，只紅本支」。不寫日期、步驟編號與單檔全套各紅幾支的過程。
