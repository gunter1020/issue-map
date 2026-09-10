<!-- PR 標題寫一句話描述這次改動，不要用約定式提交標籤開頭（feat:、fix:、chore: 等） -->

## 關聯單號

<!-- 要自動關閉 issue 得用 Closes / Fixes 開頭；相關但不關閉用 Refs #xxx。沒有就留空 -->

Closes #

## 動機

<!-- 現況哪裡有問題、不做會怎樣 -->

## 改了什麼

<!--
行為從 A 變成 B，以及讀 diff 看不出來的取捨：為什麼改在這一層、刻意不動什麼。

改變的行為有三條以上，或改動是「舊預設 → 新預設」「舊輸出 → 新輸出」這種替換關係時，
先給一張 | 情境 | 改動前 | 改動後 | 對照表，再用條列寫取捨。一列一個情境，
兩欄各填該情境下的實際值：圖上畫出什麼、CLI 印什麼、擋下來還是放行。
-->

-

## 對外契約影響

<!--
這個套件發到 npm，使用者是「在自己 repo 裡跑 bunx issue-map」的人。
對他們來說的契約有四件：兩支 bin 的用法與參數、環境變數（`scripts/issue-map.ts` 的 `CONFIG`）、
產出的 HTML 檔名與位置、package.json 的 `files` 清單。沒有就寫「無」。
-->

- [ ] **無**對外契約變動
- [ ] 改動 bin 介面 / 環境變數 / 預設值 → README 的用法與設定表已同 PR 更新
- [ ] 新增或搬動 `scripts/` 下的檔案 → package.json 的 `files` 已同步（漏了就是發出去缺檔）
- [ ] **破壞性變更**（既有使用者的既有用法會壞）→ 在下面寫清楚壞在哪、要怎麼改

## 發布注意事項

<!--
合併進 main 不會發版。release-please 會累積 conventional commits 開一支 release PR，
那支 PR 被合併時才打 tag 並自動 `npm publish`（OIDC trusted publishing）。

要寫在這裡的：這次的 commit 訊息會讓 release-please 判成 major / minor / patch 哪一種，
以及有沒有「發出去才會發現」的風險（files 清單、shebang、bin 權限、bun 版本下限）。
都沒有就寫「無」。
-->

## 驗證

<!--
跑過的指令與輸出、手動測過的情境。沒跑過的不要寫。沒涵蓋到的也寫在這裡。

    bun run check    # lint + format:check + typecheck
    bun test         # tests/ 下的模型與版面測試
    bun run mutate   # 突變測試，動到模型層時跑

真的拿一個 repo 畫過圖才算驗過端到端：

    bun run issue-map:serve
-->

-

## 審查者要注意的地方

<!-- 想被重點看的檔案、自己不確定的決定、風險與回滾方式 -->

---

- [ ] 已 rebase 至 `main` 最新狀態
- [ ] `bun run check` 與 `bun test` 綠
- [ ] 動到模型層（`scripts/issue-map-model.ts`）時已跑過 `bun run mutate`
- [ ] 行為或設定有變時已同步更新 [README.md](../README.md)
- [ ] commit 訊息用 Conventional Commits（繁中描述）——release-please 靠它決定版號
- [ ] 現在就可以審
