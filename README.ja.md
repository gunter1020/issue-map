# issue-map

[English](README.md) · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md) · **日本語**

> 原稿は[英語版](README.md)です。翻訳が遅れている場合はそちらが正です。

GitHub Issues のブロック関係を 1 ページの開発マップにします：**いま着手できるのはどれか、どれが
何を待っているか、クリティカルパスはどこを通るか。**

```bash
bunx issue-map@latest
```

見たい repo の中で実行します。ブラウザのタブが開き、更新するたびに GitHub を取り直します。状態の
正は常に GitHub Issues——このページはスナップショットで、状態は変えられません。

## なぜこれを作ったか

Agent は 1 ラウンドに 1 枚しか扱えないので、毎ラウンド実際に決めるのは**どれを渡すか**です。その
答えはどの 1 枚の中にもなく、チケットとチケットの間にあります——誰が誰をブロックしているか、親は
あと何枚のサブチケットを待っているか、いちばん長い鎖は何段か。GitHub は一度に 1 枚しか見せてくれ
ません。このページがその絵です。

[mattpocock/skills](https://github.com/mattpocock/skills) のやり方——ワークフローを skill として
書き、agent に走らせる——を前提に作っており、既定のラベルとコマンドもそこから来ています。

## 使い方

| コマンド                                            | 得られるもの                             |
| --------------------------------------------------- | ---------------------------------------- |
| `bunx issue-map@latest`                             | 空き port で server 起動、ブラウザも開く |
| `bunx -p issue-map@latest issue-map-build`          | 静的ファイルを `dist/issue-map.html` へ  |
| `bunx -p issue-map@latest issue-map-build out.html` | 静的ファイルを指定したパスへ             |

- repo は `gh` が cwd の git から推測するので、指定は不要です。
- `ISSUE_MAP_PORT` で port を固定できます。固定は厳密で、埋まっていれば黙って移らず失敗します。
- `ISSUE_MAP_OPEN=0` でタブを開きません。
- 静的ファイルは古くなります。いまの状態を見たいときは server を使ってください。
- `@latest` は npm 上の最新版です。固定するなら `bunx issue-map@0.2.0`。

## 前提条件

- **Bun**——`Bun.build`、`Bun.serve`、`Bun.file` を使っているので、Node では動きません。
- **`gh` CLI にログイン済み**で、対象 repo への読み取り権限があること。
- 対象 repo に GitHub を指す git remote があること。

runtime 依存はありません。

## 言語

右上で切り替えます：英語（既定）、繁体字中国語、簡体字中国語、日本語。選んだ言語はブラウザに記憶
され、repo ごとではありません——言語は読む人の好みであって、プロジェクトの設定ではないからです。

CLI 側（生成メッセージ、エラー）は英語のみです。

## 設定

すべて既定値があり、何も設定しなくても動きます。既定値は `scripts/issue-map.ts` の `CONFIG` に
あります。

| 環境変数                   | 既定                              | 意味                                                       |
| -------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `GH_REPO`                  | cwd の git から推測               | 別の repo を描くときに設定（`gh` 自身の変数。fork も同様） |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | サブチケットが本文で親を指す見出し                         |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | 未評価で、まだ誰にも渡せない                               |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | 評価済み・着手可                                           |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | 誰かが対応中（assignee がなくてもよい）                    |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | 人がやるもの。次の一手に実装コマンドを出さない             |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | 着手できるときにマップが促すコマンド                       |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | まだ評価が要るときにマップが促すコマンド                   |
| `ISSUE_MAP_PORT`           | OS が割り当てる空き port          | server のポート                                            |
| `ISSUE_MAP_OPEN`           | 有効                              | `0` にするとブラウザを開かない                             |

とくに考えておくべきものが 3 つ：

- **ラベルの語彙。** ready／unready の既定値は mattpocock/skills の 5 つの[標準 triage ラベル](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/triage-labels.md)
  のうち 4 つです。対象 repo が別の名前を使っているなら差し替えてください。これらのラベルが 1 つも
  現れないときは triage をゲートにしません。そうしないと全チケットが「未評価」になってしまいます
  （`in-progress` はこのツール独自で、skill 側に「対応中」のラベルはありません）。
- **コマンド名。** `/implement` と `/triage` は向こうの [`implement`](https://github.com/mattpocock/skills/tree/main/skills/engineering/implement) と
  [`triage`](https://github.com/mattpocock/skills/tree/main/skills/engineering/triage) skill です。対象 repo に実在するものを指すようにしてください。さもないと、
  存在しないものを走らせろとマップが指示します。
- **クローズ済みの兄弟にはネイティブ sub-issue が要る。** マップが問い合わせるクローズ済みチケット
  は、open なチケットがまだ指しているものだけで、子チケットはネイティブの sub-issue 関係から取り
  ます。`## Parent` の本文慣例を使う repo ではグループ内の**クローズ済み**の子が出てこず、進捗が
  実際より少なく見えます。チケットの Sub-issues で一度リンクし直せば戻ります。本文の慣例は残して
  おいて構いません——ネイティブのほうが優先されます。

## よくある失敗

`gh api graphql failed: …` — `gh` にログインしていないか、cwd が対象 repo の git ツリーの中に
ありません。

## ファイル

| ファイル                     | 責務                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `scripts/issue-map.ts`       | スナップショット取得、状態と次の一手の導出、HTML 生成。設定は `CONFIG` |
| `scripts/issue-map-model.ts` | 純粋なデータモデル：グルーピング、クリティカルパス、レイアウト         |
| `scripts/issue-map-i18n.ts`  | 4 言語の文言と引き当て                                                 |
| `scripts/issue-map-page.ts`  | ブラウザ側のコード。ビルド時に HTML へバンドルされる                   |
| `scripts/issue-map.html`     | テンプレート。2 つのプレースホルダが埋められる                         |
| `scripts/issue-map-serve.ts` | ローカル server。リクエストごとに取り直す                              |
| `scripts/mutate.ts`          | ミューテーションテスト：1 行を壊してテストが赤くなるか見る             |

## この repo で開発する

```bash
bun install
bun run issue-map:serve   # --watch。ブラウザは開かない（保存のたびにタブが増えるため）
bun run issue-map         # dist/issue-map.html を生成するだけ
bun run check             # lint + format:check + typecheck
bun test                  # 純粋なモデル層
```

この repo 自体にはまだ issue がないので、`GH_REPO=<owner>/<repo>` でチケットのある repo を指さない
と何も描けません。

**テスト。** `tests/` が守るのは「マップが嘘をつく」「読めなくなる」ことだけで、見た目（色・形・
間隔）は意図的に検証しません。ガードテストを足すときは逆検証で——そのテストが防ぐと主張する欠陥を
製品コードに戻し、赤くなることを確かめます：

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

**`scripts/issue-map-i18n.ts` を触るとき。** `EN` が原稿であり、キーの定義場所です。3 つの翻訳の型
はそこから導かれるので、キーや `{n}` の差し込み名が 1 つ欠けると `bun run typecheck` が赤くなります。
英語で単複を分けるキーは `{ one, other }`、中国語と日本語は 1 本の文字列で構いません。モデル側は文
を組み立てません——`nextStep` は `{ kind: 'waitChildren', count: 2 }` のような構造化された値で、
言葉になるのはここです。

## 2 つの設計判断

- **このページでは状態を変えられません。** GitHub に書き戻すボタンはありません。状態の正は 1 つだけ
  で、入口が増えれば必ず食い違います。
- **チケット名はマップに載せません。** ノードに載るのは番号だけで、名前は下の一覧にあります。本文に
  書いた短縮名はタイトルの 2 つ目の正であり、タイトルを直しても追随しません。
