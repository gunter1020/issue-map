<!-- 標題寫一句話描述改動，不要用 feat:／fix: 這種標籤開頭 -->

## 關聯單號

<!-- 要自動關 issue 用 Closes / Fixes；相關但不關用 Refs #xxx -->

Closes #

## 動機

<!-- 現況哪裡有問題、不做會怎樣 -->

## 改了什麼

<!--
行為從 A 變成 B，以及讀 diff 看不出來的取捨。
變動有三條以上或屬於「舊值 → 新值」的替換，先給 | 情境 | 改動前 | 改動後 | 對照表。
-->

-

## 對外契約影響

<!-- 使用者是「在自己 repo 跑 bunx issue-map」的人。沒有就寫「無」 -->

- [ ] **無**對外契約變動
- [ ] 改了 bin 用法 / 環境變數（`CONFIG`）/ 產出 HTML → README 已同 PR 更新
- [ ] 增減 `scripts/` 下的檔案 → package.json 的 `files` 已同步（漏了就是發出去缺檔，本機看不出來）
- [ ] **破壞性變更** → 寫清楚壞在哪、要怎麼改

## 發布注意事項

<!--
合併進 main 不發版。release-please 累積 commits 開 release PR，那支合併才打 tag 並 npm publish。
寫：這次的 commit 會被判成哪種 bump，以及「發出去才會發現」的風險。沒有就寫「無」。
-->

## 驗證

<!--
跑過的指令與輸出。沒跑過的不要寫，沒涵蓋到的也寫在這裡。

    bun run check    # lint + format:check + typecheck
    bun test
    bun run mutate   # 動到模型層時
-->

-

## 審查者要注意的地方

<!-- 想被重點看的檔案、不確定的決定、風險與回滾方式 -->

---

- [ ] 已 rebase 至 `main` 最新狀態
- [ ] `bun run check` 與 `bun test` 綠
- [ ] 動到 `scripts/issue-map-model.ts` 時已跑過 `bun run mutate`
- [ ] 行為或設定有變時已更新 [README.md](../README.md)
- [ ] commit 訊息用 Conventional Commits（繁中描述）——release-please 靠它決定版號
