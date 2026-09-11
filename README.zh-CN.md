# issue-map

[English](README.md) · [繁體中文](README.zh-TW.md) · **简体中文** · [日本語](README.ja.md)

> 原稿是[英文版](README.md)。翻译落后时以它为准。

把 GitHub Issues 的阻挡关系画成一页开发地图：**哪几张票现在可以动、哪几张在等谁、关键路径是哪一条。**

```bash
bunx issue-map@latest
```

在要看的那个 repo 里跑。会直接开浏览器标签页，每次刷新都重抓 GitHub。状态的权威永远是 GitHub
Issues——这一页只是快照，不能改状态。

## 为什么有这个项目

Agent 一轮吃一张票，所以每一轮真正要决定的是**派哪一张**。这个答案不在任何单一张票里，它在票与
票之间：谁挡着谁、哪一组子票还差几张、最长的那条链有多长。GitHub 一次只让你读一张票。这一页就是
那张图。

它是绕着 [mattpocock/skills](https://github.com/mattpocock/skills) 那套做法建的——把工作流写成
skill、让 agent 照着跑——默认的标签与指令也是从那里来的。

## 用法

| 指令                                                | 得到什么                         |
| --------------------------------------------------- | -------------------------------- |
| `bunx issue-map@latest`                             | server 起在空端口，自动开浏览器  |
| `bunx -p issue-map@latest issue-map-build`          | 静态文件到 `dist/issue-map.html` |
| `bunx -p issue-map@latest issue-map-build out.html` | 静态文件到你指定的路径           |

- repo 是 `gh` 从 cwd 的 git 推断的，不必填。
- `ISSUE_MAP_PORT` 固定端口。固定就是严格的：被占住时直接失败，不会偷偷换一个。
- `ISSUE_MAP_OPEN=0` 不自动开标签页。
- 静态文件会过期，要看现在的状态就用 server。
- 在跑不了 script 的地方（严格 CSP、某些预览窗），文件会退回一份纯文字的票清单，而不是一片空白。
- `@latest` 取 npm 上最新的一版；要钉住就写 `bunx issue-map@0.2.0`。

## 前置条件

- **Bun**——这几支用了 `Bun.build`、`Bun.serve`、`Bun.file`，Node 跑不起来。`npx issue-map` 一样
  可以用，只要装了 Bun：bin 是 Node 进入点，工作转给 Bun，没装就直接告诉你。
- **`gh` CLI 已登录**，而且对目标 repo 有读取权。
- 目标 repo 有 git remote 指向 GitHub。

没有 runtime 依赖。

## 语言

页面右上角切换：英文（默认）、繁体中文、简体中文、日文。选了哪一种记在浏览器，跟 repo 无关——语言
是看的人的偏好，不是某个项目的设置。

CLI 那一侧（产文件消息、错误）只有英文。

## 配置

全部有默认值，一个都不设也跑得起来。默认值长在 `scripts/issue-map.ts` 的 `CONFIG`。

| 环境变量                   | 默认                              | 意思                                                   |
| -------------------------- | --------------------------------- | ------------------------------------------------------ |
| `GH_REPO`                  | 从 cwd 的 git 推断                | 要画别的 repo 时设它（`gh` 自己的变量，fork 也交给它） |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | 子票在正文指向母票的段落标题                           |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | 还没评估完，不能交给谁做                               |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | 评估完、可以动工                                       |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | 有人在做，不必有 assignee                              |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | 要人做，下一步不写实作指令                             |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | 可以动工时图上叫人跑的指令                             |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | 还要评估时图上叫人跑的指令                             |
| `ISSUE_MAP_PORT`           | OS 指派的空端口                   | server 的端口                                          |
| `ISSUE_MAP_OPEN`           | 开                                | 设 `0` 就不自动开浏览器                                |

三个要特别想过的：

- **标签词汇。** ready／unready 的默认值是 mattpocock/skills 五个[标准 triage 标签](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/triage-labels.md)
  里的四个。目标 repo 没在用这套就换成它自己的名字。快照里完全没出现这些标签时，就不拿 triage 当
  闸门，否则每张票都会变成「待评估」。（`in-progress` 是这个工具自己加的，那套 skill 没有「有人在
  做」这个标签。）
- **指令名。** `/implement`、`/triage` 就是那边的 [`implement`](https://github.com/mattpocock/skills/tree/main/skills/engineering/implement) 与
  [`triage`](https://github.com/mattpocock/skills/tree/main/skills/engineering/triage) skill。要指向目标 repo 真的有的东西，不然图上会叫人跑不存在的。
- **已完成的兄弟票要靠原生 sub-issue。** 地图只跟 GitHub 要 open 票还牵着的 closed 票，而子票是从
  原生的 sub-issue 关系拿的。用 `## Parent` 正文惯例的 repo 看不到一组里**已完成**的子票，那一组的
  进度会比实际少。把子票在票页的 Sub-issues 关联上去一次就会回来；正文惯例可以留着，原生的本来
  就优先。

## 常见失败

`gh api graphql failed: …` — `gh` 没登录，或 cwd 不在目标 repo 的 git 树里。

## 文件

| 文件                         | 职责                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `scripts/issue-map.ts`       | 抓快照、算状态与下一步、产出 HTML。配置在里面的 `CONFIG` |
| `scripts/issue-map-model.ts` | 纯数据模型：分组、关键路径、排版。前后端共用             |
| `scripts/issue-map-i18n.ts`  | 四种语言的文案与查表                                     |
| `scripts/issue-map-page.ts`  | 浏览器端代码，构建时被打包进 HTML                        |
| `scripts/issue-map.html`     | 模板。两个占位区块会被填入                               |
| `scripts/issue-map-serve.ts` | 本机 server，每个请求重抓一次                            |
| `scripts/mutate.ts`          | 变异测试：改坏一行看测试会不会红                         |

## 在这个 repo 里开发

```bash
bun install
bun run issue-map:serve   # --watch；不自动开标签页（每存一次档就会多一个）
bun run issue-map         # 只产文件到 dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # 纯模型那一层
```

这个 repo 自己还没有 issue，`GH_REPO=<owner>/<repo>` 指到有票的 repo 才画得出东西。

**测试。** `tests/` 只守会让地图说谎或不能看的事，外观（颜色、形状、间距）刻意不验。新增守门测试
要走反向验证——把它宣称要挡的缺陷放回产品代码，确认它会红：

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

**要动 `scripts/issue-map-i18n.ts`。** `EN` 是原稿，也是键的定义处；三份翻译的类型由它推导，少一个
键或少一个 `{n}` 代入名，`bun run typecheck` 就会红。英文要分单复数的键写成 `{ one, other }`，中日
文写一句字符串就好。模型那一侧不算句子——`nextStep` 是 `{ kind: 'waitChildren', count: 2 }` 这种结构
化的值，话在这里才组出来。

## 两个设计上的决定

- **这一页不能改状态。** 没有按钮会回写 GitHub。状态只有一个事实来源，多一个入口就会不一致。
- **不另设短名字段。** 站点标的是标题的开头几个字。在票里手动维护一个短名会变成票名的第二个
  事实来源，改标题不会跟着改。完整标题在下方清单。
