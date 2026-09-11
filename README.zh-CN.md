# issue-map

[English](README.md) · [繁體中文](README.zh-TW.md) · **简体中文** · [日本語](README.ja.md)

> 原稿是[英文版](README.md)。翻译落后时以它为准。

把 GitHub Issues 的阻挡关系画成一页开发地图：**哪几张票现在可以动、哪几张在等谁、关键路径是哪一条。**

状态的权威永远是 GitHub Issues。这一页只是快照，页面上不能改状态——所以不会长出第二个事实来源。

## 为什么有这个项目

起点是 [mattpocock/skills](https://github.com/mattpocock/skills)。团队照它那套「把工作流写成
skill、让 agent 照着跑」开始做事之后，开票变得很便宜：想到一件事就开一张票，交给 skill 去接。
票因此长得很快——那是流程在运作的证据，不是问题。

问题在下一步。Agent 一轮吃一张票，所以每一轮真正要决定的是**派哪一张**，而这个答案不在任何
单一张票里，它在票与票之间：谁挡着谁、哪一组子票还差几张、最长的那条链有多长。GitHub Issues
一次只让你读一张票，要凑出那张图就得一张一张点开来，而且每天都要重凑一次。

这一页就是那张图。

## 用法

在**要看的那个 repo** 里跑：

```bash
bunx issue-map@latest
```

`@latest` 取 npm 上最新的一版；要钉住特定版本就写 `bunx issue-map@0.2.0`。

起在 `http://localhost:4747` **并直接开浏览器**。每次刷新都重抓 GitHub，看到的一定是现在的状态。repo 是 `gh` 从 cwd 的 git 推断的，不必填。

不要自动开标签页就设 `ISSUE_MAP_OPEN=0`。

只要一份静态 HTML 的话（`-p` 是用来选另一个 bin 的，少了它会变成起 server）：

```bash
bunx -p issue-map@latest issue-map-build            # 写到 dist/issue-map.html
bunx -p issue-map@latest issue-map-build out.html
```

快照就是快照——状态会过期，要看现在的状态就用上面的 server。

## 语言

页面右上角切换，**默认英文**，另外支持繁体中文、简体中文、日文。选了哪一种记在浏览器
（localStorage 的 `issue-map:locale`），跟 repo 无关——语言是看的人的偏好，不是某个项目的设置。
刻意不看 `navigator.language`：默认就是英文，猜错了反而每次进来都要改回去。

文案全部在 `scripts/issue-map-i18n.ts`，那是页面上每一句话的唯一来源：

- `EN` 是原稿，也是键的定义处。三份翻译的类型由它推导，少翻一个键 `bun run typecheck` 就会红。
- 句子里的代入名（`{n}`、`{issues}`）也是类型的一部分，少传一个编不过——不然缺的那个会以
  `{n}` 的样子印在画面上，而那要真的跑到那一格才看得到。
- 英文要分单复数的键写成 `{ one, other }`，中日文写一句字符串就好（`Intl.PluralRules` 对这几种
  语言只有 `other`）。

模型与抓取那一侧**不再算好句子**：`nextStep` 是 `{ kind: 'waitChildren', count: 2 }` 这种结构化
的值，分组名字也一样，话在 i18n 那一层才组出来。快照里存中文句子的话，换一次语言就得重抓一次
GitHub。

CLI 那一侧（产文件消息、错误）只有英文，也不跟着页面的语言走：那是 `bunx issue-map` 的输出，给下指令的人看的，不是页面的一部分。例外是 `scripts/mutate.ts`——它是这个 repo 内部的工具，留中文。

## 前置条件

- **Bun**。这几支用了 `Bun.build`、`Bun.serve`、`Bun.file` 与 bun 的 `spawnSync`，Node 跑不起来。
- **`gh` CLI 已登录**，而且对目标 repo 有读取权。
- 目标 repo 有 git remote 指向 GitHub。
- 没有 runtime 依赖；devDependencies 只有类型与 lint／format 工具。

## 配置

全部有默认值，一个都不设也跑得起来。默认值长在 `scripts/issue-map.ts` 的 `CONFIG`。

| 环境变量                   | 默认                              | 意思                                                                                                       |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GH_REPO`                  | 从 cwd 的 git 推断                | 要画别的 repo 时设它（`gh` 自己的变量，fork 与多 remote 也交给它）                                         |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | 子票在正文指向母票的段落标题。GitHub 原生 sub-issue 有值时优先，而且只有原生的看得到已完成的兄弟票（见下） |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | 挂了就是还没评估完，不能交给谁做                                                                           |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | 挂了才算评估完、可以动工                                                                                   |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | 挂了代表有人在做，不必有 assignee                                                                          |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | 这些要人做，下一步不写实作指令                                                                             |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | 可以动工时图上叫人跑的指令                                                                                 |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | 还要评估时图上叫人跑的指令                                                                                 |
| `ISSUE_MAP_PORT`           | `4747`                            | server 的端口                                                                                              |
| `ISSUE_MAP_OPEN`           | 开                                | 设 `0` 就不自动开浏览器（`bun --watch` 的开发模式默认关掉）                                                |

三个要特别想过的：

- **标签词汇**：目标 repo 没在用这套标签就要换成它自己的名字。程序会侦测——快照里完全没出现 ready／unready 任何一个标签时，就不拿 triage 当闸门，否则每张票都会变成「待评估」。
- **指令名**：`/implement`、`/triage` 是 Claude Code 的 skill。目标 repo 没有的话一定要换掉，不然图上会叫人跑不存在的东西。
- **已完成的兄弟票要靠原生 sub-issue**：地图只跟 GitHub 要 open 票还牵着的 closed 票——它的阻挡者、它的 parent，以及那个 parent 底下的子票。子票是从 GitHub 原生的 sub-issue 关系拿的，所以用 `## Parent` 正文惯例的 repo 看不到一组里**已完成**的子票，那一组的进度会比实际少。open 票不受影响。另一条路是整包扫过 repo 里所有 closed 票，而那在老 repo 上是几十次请求换个位数张票。

## 常见失败

- `gh api graphql failed: …` — `gh` 没登录，或 cwd 不在目标 repo 的 git 树里。

## 文件

| 文件                         | 职责                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `scripts/issue-map.ts`       | 抓快照、算每张票的状态与下一步、产出 HTML。移植配置在里面的 `CONFIG`   |
| `scripts/issue-map-model.ts` | 纯数据模型：分组、关键路径。前后端共用                                 |
| `scripts/issue-map-i18n.ts`  | 四种语言的文案与查表。页面上每一句话的唯一来源                         |
| `scripts/issue-map-page.ts`  | 浏览器端代码，构建时被打包进 HTML                                      |
| `scripts/issue-map.html`     | 模板。两个占位区块（`issue-map-data`、`issue-map-code`）会被填入       |
| `scripts/issue-map-serve.ts` | 本机 server，每个请求重抓一次                                          |
| `scripts/mutate.ts`          | 变异测试：改坏一行看测试会不会红。守门测试的反向验证用它，不要手改文件 |

## 在这个 repo 里开发

```bash
bun install
bun run issue-map:serve   # --watch，改代码会自动重启；刻意不自动开浏览器（每存一次档就会多一个标签页）
bun run issue-map         # 只产文件到 dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # 纯模型那一层（分组、关键路径、排版）
```

这个 repo 自己还没有 issue，`GH_REPO=<owner>/<repo>` 指到有票的 repo 才画得出东西。

`tests/` 只守会让地图说谎或不能看的事，外观（颜色、形状、间距）刻意不验。新增守门测试要走反向验证——把它宣称要挡的缺陷放回产品代码，确认它会红：

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

## 两个设计上的决定，改之前先知道

- **这一页不能改状态。** 没有按钮会回写 GitHub。刻意的：状态只有一个事实来源，多一个入口就会不一致。
- **票名不进地图。** 节点只挂票号，名字在下方清单。试过在正文加短名段落，那是票名的第二个事实来源，改标题不会改它；机械缩短标题读不通。
