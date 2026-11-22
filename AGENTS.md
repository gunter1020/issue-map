# AGENTS

## 產品的使用者

本專案的使用者是透過 `issue-map`（CLI、靜態 HTML 或 macOS 桌面 app）查看 GitHub Issues 阻擋關係與本機分支狀態的開發者，不含本 repo 的維護者。講使用者體驗時以終端使用者的讀圖與操作感受為準。

## 必須停下來問的事

除了 `devteam:team` 規定的縮減票範圍與不可逆改動之外，遇到以下兩件事也必須停下來問維護者，不能自行執行：

1. **合併 `release-please` 的 release PR**：合併進 `main` 會觸發自動打 tag 與 `npm publish`（見 `.github/workflows/release.yml`）。
2. **變更目標 GitHub repo 設定**：例如新建／修改標籤或調整分支保護／ruleset。

## 專案契約

所有角色規則與專案事實集中在 `docs/agents/`（領域詞彙與架構決定另外在 `CONTEXT.md` 與 `docs/adr/`），實作、審查、測試與收票前一律先讀對應的檔與節。
