# 分類與狀態標籤

各個 skill 以票的類別、標準 triage 角色與手動接手狀態溝通；以下對照表列出本 repo 在 GitHub tracker（`gh label list`）實際使用的標籤字串。

## 類別（Category）

| 角色        | 本 repo 標籤  | 意義             |
| ----------- | ------------- | ---------------- |
| bug         | `bug`         | 功能異常或錯誤   |
| enhancement | `enhancement` | 新功能或改進請求 |

## 狀態（Status）

| 角色              | 本 repo 標籤      | 意義                               |
| ----------------- | ----------------- | ---------------------------------- |
| `needs-triage`    | `needs-triage`    | 尚待維護者評估這張票               |
| `needs-info`      | `needs-info`      | 等待回報者補充更多資訊             |
| `ready-for-agent` | `ready-for-agent` | 規格已明確，可交給無人值守代理實作 |
| `ready-for-human` | `ready-for-human` | 需要人工實作                       |
| `wontfix`         | `wontfix`         | 不會處理                           |

## 手動維護（Manual hand-off）

| 角色          | 本 repo 標籤  | 意義                                                       |
| ------------- | ------------- | ---------------------------------------------------------- |
| `in-progress` | `in-progress` | 有人正在處理（對應 `src/issue-map.ts` 的 `CONFIG.active`） |

當 skill 提到某個角色（例如「掛上可由代理接手的標籤」或「移除接手標籤」）時，一律使用上表對應的標籤字串。
