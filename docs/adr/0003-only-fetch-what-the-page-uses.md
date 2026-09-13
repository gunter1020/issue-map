# 0003. 只抓頁面真的用得到的欄位

## 背景

抓取原本對每一張票都要完整欄位，其中 `body` 佔了回應的絕大部分——實測 `vitejs/vite` 單頁
449,317 bytes 裡 `body` 佔 414,296（92.2%）。而它只餵 `PARENT_IN_BODY` 一條 regex，`MapIssue`
連這個欄位都沒有；用 GitHub 原生 sub-issue 的 repo 一個字都用不到。

子票那一趟也是：`subIssues` 沒有 `states:` 可以篩，開著的一定會一起回來，而開著的兄弟本來就
在 open 那包。整包完整欄位抓回來再丟掉，等於每次都在重抓自己已經有的東西。

`run()` 是 `spawnSync`，所以互不相干的查詢沒辦法並行；server 那邊同步等還會把整條 event loop
卡住，先抓完的請求也得等另一個抓完才寫得出回應。

## 決定

- 內文改成**明講才抓**：`ISSUE_MAP_PARENT_HEADING` 的預設值由 `Parent` 改成未設。這是破壞性
  變更，靠內文慣例的 repo 要明確設定才會照舊。
- 子票那一趟只問 `number state`，完整欄位併進「指名去要」那一趟，所以完整欄位只抓一次、只抓
  真的會留下的那些。
- `run()` 改非同步，alias 批次之間走 `Promise.all`。

## 代價

- **破壞性變更**：用 `## Parent` 慣例又沒設環境變數的 repo，母子關係會整批消失。四份 README
  都寫了，但升級的人不看 CHANGELOG 就會踩到。
- 子票那一趟與指名去要那一趟變成前後相依，不能並行。換來的是傳輸量大降，實測仍然更快。
- 非同步讓 `takeSnapshot()` 變成 `Promise`，server 與 bin 都要跟。

實測 `GH_REPO=vitejs/vite`（498 open issue）：9.07s → 6.93s；設了 heading 時 8.90s。三種情況
產出的票數相同，未設 heading 的產出與改動前逐字一致。
