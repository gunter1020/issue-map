# 票務系統：GitHub Issues

本專案的票與規格以 GitHub Issues 管理，所有讀寫操作一律透過 `gh` CLI。

## 操作慣例

- **建票**：`gh issue create --title "..." --body "..."`，多行內文用 heredoc。
- **讀票**：`gh issue view <number> --comments`，需要時搭配 `jq` 篩選留言與標籤。
- **列票**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，依需要加上 `--label` 與 `--state` 篩選。
- **留言**：`gh issue comment <number> --body "..."`。
- **增減標籤**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **關票**：`gh issue close <number> --comment "..."`。

在 clone 目錄內執行時，`gh` 會自動依 `git remote -v` 推斷目標 repo。

## 以 PR 作為需求入口

**以 PR 作為需求入口：否。**（若本專案將外部 PR 視為功能請求，再改為「是」供 `/triage` 讀取。）

當設為「是」時，PR 會走與 issue 相同的標籤與狀態流程，改用對應的 `gh pr` 指令：

- **讀 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只保留 `authorAssociation` 為 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的項目（排除 `OWNER`／`MEMBER`／`COLLABORATOR`）。
- **留言／改標籤／關 PR**：`gh pr comment`、`gh pr edit --add-label`／`--remove-label`、`gh pr close`。

GitHub 的 issue 與 PR 共用同一組編號空間，裸號 `#42` 可能是其中任一種：先用 `gh pr view 42` 解析，查不到再退回 `gh issue view 42`。

## 當 skill 指示「publish to the issue tracker」

建立一張 GitHub issue。

## 當 skill 指示「fetch the relevant ticket」

執行 `gh issue view <number> --comments`。

## Wayfinding 操作

由 `/wayfinder` 使用：**地圖（map）**是一張主票，底下以**子票（child）**代表各張任務票。

- **主票（Map）**：掛上 `wayfinder:map` 標籤的單一 issue，內文存放 Notes / Decisions-so-far / Fog。指令：`gh issue create --label wayfinder:map`。
- **子票**：透過 GitHub sub-issue（`gh api` 呼叫 sub-issues 端點）連結到主票。若尚未啟用 sub-issues，改在主票內文加入 task list，並在子票開頭寫 `Part of #<map>`。標籤用 `wayfinder:<type>`（`research`／`prototype`／`grilling`／`task`）；認領後即指派給負責開發者。
- **阻擋關係（Blocking）**：以 GitHub **原生的 issue dependencies** 為唯一事實來源（UI 上直接可見）。新增阻擋邊：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻擋者的數字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，注意**不是** `#number` 或 `node_id`）。GitHub 會以 `issue_dependencies_summary.blocked_by` 回報還開著的阻擋數（實際閘門）。若無法使用原生 dependencies，則退回在子票開頭寫 `Blocked by: #<n>, #<n>`。所有阻擋者都關閉時該票即解鎖。
- **前線查詢（Frontier query）**：列出主票底下開著的子票（`gh issue list --state open`，範圍限於主票的 sub-issues 或 task list），濾掉仍有未關閉阻擋者（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行內仍有開著的票）或已有 assignee 的票；依地圖順序取第一張。
- **認領（Claim）**：`gh issue edit <n> --add-assignee @me`，作為該輪第一個寫入動作。
- **結案（Resolve）**：`gh issue comment <n> --body "<answer>"`，接著 `gh issue close <n>`，並將脈絡指標（gist 與連結）補進主票的 Decisions-so-far。

## 什麼該變成票

審查與實作途中的發現預設不開票，照順序判斷去處：

1. **當場修掉**：不改公開契約（`Snapshot`／`MapIssue` 形狀、CLI 旗標與環境變數、產出 HTML 結構、本機 JSON 保存格式）、不需要新增測試、小到寫票比改還貴——三條都成立就改在手上的 diff 裡，commit 訊息帶一句。不確定算不算就是不算。
2. **開票**：滿足任一條。
   - 擋住一張已經決定要做的票（寫出哪一張）。
   - 對應一個已經觀察到的使用者可見錯誤行為（寫重現步驟或實際輸出，不是推論）。
   - 是母票驗收區明文列出的項目（寫出母票與哪一項）。

   「使用者」是 `AGENTS.md` 說的透過 CLI、靜態頁面或桌面 app 查看地圖的開發者，不含維護者：測試穩定性、殘留暫存檔、覆蓋率缺口傷的是跑測試的人，不記；哪天真的擋住一次合併，改走第一款。

3. **其他不記**，尤其是「X 沒有判準／讀數／守門測試／型別上擋不住」——要變成票必須指出一個因為缺它而實際漏掉的錯誤行為。

代理不自己開票：把需要開的票列給維護者，標題用 `CONTEXT.md` 的詞，逐項標明過的是哪一條，過不了的標「不記」。

已經開出來的票過不了門檻時，以 `gh issue close --reason "not planned"` 關掉，不掛 `wontfix`，留言寫過不了哪一條、缺什麼、什麼條件成立該重開。拒絕一個請求時，理由寫在關票留言，不另建紀錄。

## Definition of Done

PR 合併之後才走；合併前只把證據補到票上，不勾驗收、不關票。

1. 跑完驗收所需的檢查，確認票的範圍全部交付。
2. 驗收區（`## 驗收` 底下的 `- [ ]` checkbox）每一項有直接證據才把 `- [ ]` 改成 `- [x]`，用 `gh issue edit <n> --body-file <file>` 更新全文；不改驗收項目的文字與驗收區以外的內容。仍有未勾項時票保持開啟，回報缺什麼。（既有的已關舊票若採一般條列，不追溯改寫。）
3. 留完成摘要：commit、完成的行為、逐項驗收證據、檢查結果、沒修的審查 finding 與理由、仍需揭露的限制。
4. 拿掉 `in-progress` 標籤並關票。
5. 讀回內文與狀態，確認驗收全部 `[x]` 且狀態是 `CLOSED`，才回報完成。

母票等所有子票關閉、完整範圍交付後才留言並關閉。
