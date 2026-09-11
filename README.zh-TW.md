# issue-map

[English](README.md) · **繁體中文** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

> 原稿是[英文版](README.md)。翻譯落後時以它為準。

把 GitHub Issues 的阻擋關係畫成一頁開發地圖：**哪幾張票現在可以動、哪幾張在等誰、關鍵路徑是哪一條。**

```bash
bunx issue-map@latest
```

在要看的那個 repo 裡跑。會直接開瀏覽器分頁，每次重新整理都重抓 GitHub。狀態的權威永遠是 GitHub
Issues——這一頁只是快照，不能改狀態。

## 為什麼有這個專案

Agent 一輪吃一張票，所以每一輪真正要決定的是**派哪一張**。這個答案不在任何單一張票裡，它在票與
票之間：誰擋著誰、哪一組子票還差幾張、最長的那條鏈有多長。GitHub 一次只讓你讀一張票。這一頁就是
那張圖。

它是繞著 [mattpocock/skills](https://github.com/mattpocock/skills) 那套做法建的——把工作流寫成
skill、讓 agent 照著跑——預設的標籤與指令也是從那裡來的。

## 用法

| 指令                                                | 得到什麼                         |
| --------------------------------------------------- | -------------------------------- |
| `bunx issue-map@latest`                             | server 起在空 port，自動開瀏覽器 |
| `bunx -p issue-map@latest issue-map-build`          | 靜態檔到 `dist/issue-map.html`   |
| `bunx -p issue-map@latest issue-map-build out.html` | 靜態檔到你指定的路徑             |

- repo 是 `gh` 從 cwd 的 git 推斷的，不必填。
- `ISSUE_MAP_PORT` 固定 port。固定就是嚴格的：被佔住時直接失敗，不會偷偷換一個。
- `ISSUE_MAP_OPEN=0` 不自動開分頁。
- 靜態檔會過期，要看現在的狀態就用 server。
- 在跑不了 script 的地方（嚴格 CSP、某些預覽窗），檔案會退回一份純文字的票清單，而不是一片空白。
- `@latest` 取 npm 上最新的一版；要釘住就寫 `bunx issue-map@0.2.0`。

## 前置條件

- **Bun**——這幾支用了 `Bun.build`、`Bun.serve`、`Bun.file`，Node 跑不起來。`npx issue-map` 一樣
  可以用，只要裝了 Bun：bin 是 Node 進入點，工作轉給 Bun，沒裝就直接告訴你。
- **`gh` CLI 已登入**，而且對目標 repo 有讀取權。
- 目標 repo 有 git remote 指向 GitHub。

沒有 runtime 依賴。

## 語言

頁面右上角切換：英文（預設）、繁體中文、簡體中文、日文。選了哪一種記在瀏覽器，跟 repo 無關——語言
是看的人的偏好，不是某個專案的設定。

CLI 那一側（產檔訊息、錯誤）只有英文。

## 設定

全部有預設值，一個都不設也跑得起來。預設值長在 `scripts/issue-map.ts` 的 `CONFIG`。

| 環境變數                   | 預設                              | 意思                                                   |
| -------------------------- | --------------------------------- | ------------------------------------------------------ |
| `GH_REPO`                  | 從 cwd 的 git 推斷                | 要畫別的 repo 時設它（`gh` 自己的變數，fork 也交給它） |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | 子票在內文指向母票的段落標題                           |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | 還沒評估完，不能交給誰做                               |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | 評估完、可以動工                                       |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | 有人在做，不必有 assignee                              |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | 要人做，下一步不寫實作指令                             |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | 可以動工時圖上叫人跑的指令                             |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | 還要評估時圖上叫人跑的指令                             |
| `ISSUE_MAP_PORT`           | OS 指派的空 port                  | server 的 port                                         |
| `ISSUE_MAP_OPEN`           | 開                                | 設 `0` 就不自動開瀏覽器                                |

三個要特別想過的：

- **標籤字彙。** ready／unready 的預設值是 mattpocock/skills 五個[標準 triage 標籤](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/triage-labels.md)
  裡的四個。目標 repo 沒在用這套就換成它自己的名字。快照裡完全沒出現這些標籤時，就不拿 triage 當
  閘門，否則每張票都會變成「待評估」。（`in-progress` 是這個工具自己加的，那套 skill 沒有「有人在
  做」這個標籤。）
- **指令名。** `/implement`、`/triage` 就是那邊的 [`implement`](https://github.com/mattpocock/skills/tree/main/skills/engineering/implement) 與
  [`triage`](https://github.com/mattpocock/skills/tree/main/skills/engineering/triage) skill。要指向目標 repo 真的有的東西，不然圖上會叫人跑不存在的。
- **已完成的兄弟票要靠原生 sub-issue。** 地圖只跟 GitHub 要 open 票還牽著的 closed 票，而子票是從
  原生的 sub-issue 關係拿的。用 `## Parent` 內文慣例的 repo 看不到一組裡**已完成**的子票，那一組的
  進度會比實際少。把子票在票頁的 Sub-issues 關聯上去一次就會回來；內文慣例可以留著，原生的本來
  就優先。

## 常見失敗

`gh api graphql failed: …` — `gh` 沒登入，或 cwd 不在目標 repo 的 git 樹裡。

## 檔案

| 檔案                         | 責任                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `scripts/issue-map.ts`       | 抓快照、算狀態與下一步、產出 HTML。設定在裡面的 `CONFIG` |
| `scripts/issue-map-model.ts` | 純資料模型：分組、關鍵路徑、排版。前後端共用             |
| `scripts/issue-map-i18n.ts`  | 四種語言的文案與查表                                     |
| `scripts/issue-map-page.ts`  | 瀏覽器端程式碼，建置時被打包進 HTML                      |
| `scripts/issue-map.html`     | 樣板。兩個佔位區塊會被填入                               |
| `scripts/issue-map-serve.ts` | 本機 server，每個請求重抓一次                            |
| `scripts/mutate.ts`          | 突變測試：改壞一行看測試會不會紅                         |

## 在這個 repo 裡開發

```bash
bun install
bun run issue-map:serve   # --watch；不自動開分頁（每存一次檔就會多一個）
bun run issue-map         # 只產檔到 dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # 純模型那一層
```

這個 repo 自己還沒有 issue，`GH_REPO=<owner>/<repo>` 指到有票的 repo 才畫得出東西。

**測試。** `tests/` 只守會讓地圖說謊或不能看的事，外觀（顏色、形狀、間距）刻意不驗。新增守門測試
要走反向驗證——把它宣稱要擋的缺陷放回產品碼，確認它會紅：

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

**要動 `scripts/issue-map-i18n.ts`。** `EN` 是原稿，也是鍵的定義處；三份翻譯的型別由它推導，少一個
鍵或少一個 `{n}` 代入名，`bun run typecheck` 就會紅。英文要分單複數的鍵寫成 `{ one, other }`，中日
文寫一句字串就好。模型那一側不算句子——`nextStep` 是 `{ kind: 'waitChildren', count: 2 }` 這種結構
化的值，話在這裡才組出來。

## 兩個設計上的決定

- **這一頁不能改狀態。** 沒有按鈕會回寫 GitHub。狀態只有一個事實來源，多一個入口就會不一致。
- **不另設短名欄位。** 站點標的是標題的開頭幾個字。在票裡手動維護一個短名會變成票名的第二個
  事實來源，改標題不會跟著改。完整標題在下方清單。
