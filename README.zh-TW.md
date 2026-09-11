# issue-map

[English](README.md) · **繁體中文** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

> 原稿是[英文版](README.md)。翻譯落後時以它為準。

把 GitHub Issues 的阻擋關係畫成一頁開發地圖：**哪幾張票現在可以動、哪幾張在等誰、關鍵路徑是哪一條。**

狀態的權威永遠是 GitHub Issues。這一頁只是快照，頁面上不能改狀態——所以不會長出第二個事實來源。

## 為什麼有這個專案

起點是 [mattpocock/skills](https://github.com/mattpocock/skills)。團隊照它那套「把工作流寫成
skill、讓 agent 照著跑」開始做事之後，開票變得很便宜：想到一件事就開一張票，交給 skill 去接。
票因此長得很快——那是流程在運作的證據，不是問題。

問題在下一步。Agent 一輪吃一張票，所以每一輪真正要決定的是**派哪一張**，而這個答案不在任何
單一張票裡，它在票與票之間：誰擋著誰、哪一組子票還差幾張、最長的那條鏈有多長。GitHub Issues
一次只讓你讀一張票，要湊出那張圖就得一張一張點開來，而且每天都要重湊一次。

這一頁就是那張圖。

## 用法

在**要看的那個 repo** 裡跑：

```bash
bunx issue-map@latest
```

`@latest` 取 npm 上最新的一版；要釘住特定版本就寫 `bunx issue-map@0.2.0`。

起在 OS 給的一個空 port **並直接開瀏覽器**；啟動訊息會印出正在畫的目錄與網址，所以好幾個 repo 同時跑也不會撞。要固定 port 就設 `ISSUE_MAP_PORT`，那個是嚴格的——被佔住時直接失敗，不會偷偷換一個。每次重新整理都重抓 GitHub，看到的一定是現在的狀態。repo 是 `gh` 從 cwd 的 git 推斷的，不必填。

不要自動開分頁就設 `ISSUE_MAP_OPEN=0`。

只要一份靜態 HTML 的話（`-p` 是用來選另一個 bin 的，少了它會變成起 server）：

```bash
bunx -p issue-map@latest issue-map-build            # 寫到 dist/issue-map.html
bunx -p issue-map@latest issue-map-build out.html
```

快照就是快照——狀態會過期，要看現在的狀態就用上面的 server。

## 語言

頁面右上角切換，**預設英文**，另外支援繁體中文、簡體中文、日文。選了哪一種記在瀏覽器
（localStorage 的 `issue-map:locale`），跟 repo 無關——語言是看的人的偏好，不是某個專案的設定。
刻意不看 `navigator.language`：預設就是英文，猜錯了反而每次進來都要改回去。

文案全部在 `scripts/issue-map-i18n.ts`，那是頁面上每一句話的唯一來源：

- `EN` 是原稿，也是鍵的定義處。三份翻譯的型別由它推導，少翻一個鍵 `bun run typecheck` 就會紅。
- 句子裡的代入名（`{n}`、`{issues}`）也是型別的一部分，少傳一個編不過——不然缺的那個會以
  `{n}` 的樣子印在畫面上，而那要真的跑到那一格才看得到。
- 英文要分單複數的鍵寫成 `{ one, other }`，中日文寫一句字串就好（`Intl.PluralRules` 對這幾種
  語言只有 `other`）。

模型與抓取那一側**不再算好句子**：`nextStep` 是 `{ kind: 'waitChildren', count: 2 }` 這種結構化
的值，分組名字也一樣，話在 i18n 那一層才組出來。快照裡存中文句子的話，換一次語言就得重抓一次
GitHub。

CLI 那一側（產檔訊息、錯誤）只有英文，也不跟著頁面的語言走：那是 `bunx issue-map` 的輸出，給下指令的人看的，不是頁面的一部分。例外是 `scripts/mutate.ts`——它是這個 repo 內部的工具，留中文。

## 前置條件

- **Bun**。這幾支用了 `Bun.build`、`Bun.serve`、`Bun.file` 與 bun 的 `spawnSync`，Node 跑不起來。
- **`gh` CLI 已登入**，而且對目標 repo 有讀取權。
- 目標 repo 有 git remote 指向 GitHub。
- 沒有 runtime 依賴；devDependencies 只有型別與 lint／format 工具。

## 設定

全部有預設值，一個都不設也跑得起來。預設值長在 `scripts/issue-map.ts` 的 `CONFIG`。

| 環境變數                   | 預設                              | 意思                                                                                                       |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GH_REPO`                  | 從 cwd 的 git 推斷                | 要畫別的 repo 時設它（`gh` 自己的變數，fork 與多 remote 也交給它）                                         |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | 子票在內文指向母票的段落標題。GitHub 原生 sub-issue 有值時優先，而且只有原生的看得到已完成的兄弟票（見下） |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | 掛了就是還沒評估完，不能交給誰做                                                                           |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | 掛了才算評估完、可以動工                                                                                   |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | 掛了代表有人在做，不必有 assignee                                                                          |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | 這些要人做，下一步不寫實作指令                                                                             |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | 可以動工時圖上叫人跑的指令                                                                                 |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | 還要評估時圖上叫人跑的指令                                                                                 |
| `ISSUE_MAP_PORT`           | OS 指派的空 port                  | server 的 port                                                                                             |
| `ISSUE_MAP_OPEN`           | 開                                | 設 `0` 就不自動開瀏覽器（`bun --watch` 的開發模式預設關掉）                                                |

三個要特別想過的：

- **標籤字彙**：目標 repo 沒在用這套標籤就要換成它自己的名字。程式會偵測——快照裡完全沒出現 ready／unready 任何一個標籤時，就不拿 triage 當閘門，否則每張票都會變成「待評估」。
- **指令名**：`/implement`、`/triage` 是 Claude Code 的 skill。目標 repo 沒有的話一定要換掉，不然圖上會叫人跑不存在的東西。
- **已完成的兄弟票要靠原生 sub-issue**：地圖只跟 GitHub 要 open 票還牽著的 closed 票——它的阻擋者、它的 parent，以及那個 parent 底下的子票。子票是從 GitHub 原生的 sub-issue 關係拿的，所以用 `## Parent` 內文慣例的 repo 看不到一組裡**已完成**的子票，那一組的進度會比實際少。open 票不受影響。另一條路是整包掃過 repo 裡所有 closed 票，而那在老 repo 上是幾十次請求換個位數張票。一組票如果是原生 sub-issue 之前開的，把子票關聯上去一次（票頁的 Sub-issues）就會回來；內文慣例可以留著，原生的本來就優先。

## 常見失敗

- `gh api graphql failed: …` — `gh` 沒登入，或 cwd 不在目標 repo 的 git 樹裡。

## 檔案

| 檔案                         | 責任                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `scripts/issue-map.ts`       | 抓快照、算每張票的狀態與下一步、產出 HTML。移植設定在裡面的 `CONFIG`   |
| `scripts/issue-map-model.ts` | 純資料模型：分組、關鍵路徑。前後端共用                                 |
| `scripts/issue-map-i18n.ts`  | 四種語言的文案與查表。頁面上每一句話的唯一來源                         |
| `scripts/issue-map-page.ts`  | 瀏覽器端程式碼，建置時被打包進 HTML                                    |
| `scripts/issue-map.html`     | 樣板。兩個佔位區塊（`issue-map-data`、`issue-map-code`）會被填入       |
| `scripts/issue-map-serve.ts` | 本機 server，每個請求重抓一次                                          |
| `scripts/mutate.ts`          | 突變測試：改壞一行看測試會不會紅。守門測試的反向驗證用它，不要手改檔案 |

## 在這個 repo 裡開發

```bash
bun install
bun run issue-map:serve   # --watch，改程式碼會自動重啟；刻意不自動開瀏覽器（每存一次檔就會多一個分頁）
bun run issue-map         # 只產檔到 dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # 純模型那一層（分組、關鍵路徑、排版）
```

這個 repo 自己還沒有 issue，`GH_REPO=<owner>/<repo>` 指到有票的 repo 才畫得出東西。

`tests/` 只守會讓地圖說謊或不能看的事，外觀（顏色、形狀、間距）刻意不驗。新增守門測試要走反向驗證——把它宣稱要擋的缺陷放回產品碼，確認它會紅：

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

## 兩個設計上的決定，改之前先知道

- **這一頁不能改狀態。** 沒有按鈕會回寫 GitHub。刻意的：狀態只有一個事實來源，多一個入口就會不一致。
- **票名不進地圖。** 節點只掛票號，名字在下方清單。試過在內文加短名段落，那是票名的第二個事實來源，改標題不會改它；機械縮短標題讀不通。
