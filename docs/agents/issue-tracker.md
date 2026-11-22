# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

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
