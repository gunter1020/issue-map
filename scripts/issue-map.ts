#!/usr/bin/env bun
/**
 * 開發地圖：把 GitHub Issues 的阻擋關係抓下來，塞進 `scripts/issue-map.html` 這份樣板，產出一頁
 * 可以直接看的 HTML。
 *
 * 狀態的權威永遠是 GitHub Issues。這一頁只是**快照**：頁面上不能改狀態，要更新就重跑這支。
 * 這樣不會長出第二個事實來源。
 *
 * 每張票的狀態、在等誰、下一步都在這裡算完才送進頁面，樣板只負責畫。
 *
 * 帶進快照的 issue：所有 open issue，加上仍被 open issue 牽著的 closed issue。後者畫成「已完成」
 * 的節點讓進度看得見，沒人牽著之後自然消失。
 *
 * **要畫哪個 repo**：從 cwd 的 git 推斷，不必填——在那個 repo 裡跑 `bunx github:gunter1020/issue-map`
 * 就好。要指定別的 repo 設 `GH_REPO`。標籤字彙與 parent 的慣例都能用環境變數調，見底下的
 * `CONFIG`，整份對照表在 README。
 *
 * 票名不進地圖。曾經試過在內文加一個 `## 短名` 段落給站點當標籤，但那要每張票靠人維護、
 * 而且是票名的第二個事實來源，改標題不會改它。機械縮短標題也試過，這裡的標題沒有一致結構，
 * 縮出來讀不通。所以站點只掛票號，名字交給清單。
 *
 * 用法：
 *   bun run scripts/issue-map.ts                  # 寫到 dist/issue-map.html
 *   bun run scripts/issue-map.ts path/to/out.html
 *
 * 要「重新整理就是最新」，改跑 `scripts/issue-map-serve.ts`：它每個請求都呼叫這裡的
 * `takeSnapshot` 重抓一次。
 */

import { spawnSync } from 'bun'

import {
  criticalPathOf,
  groupsOf,
  type MapIssue,
  type Snapshot,
  type Status,
} from './issue-map-model.ts'

const TEMPLATE = new URL('./issue-map.html', import.meta.url).pathname
const CLIENT = new URL('./issue-map-page.ts', import.meta.url).pathname
const OUTPUT = process.argv[2] ?? 'dist/issue-map.html'

/** 一次查得回來的上限。GraphQL 的 `first` 最多就是 100，超過會少票，所以超過就喊。 */
const PAGE = 100

function labelList(raw: string | undefined, fallback: string): readonly string[] {
  return (raw ?? fallback)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

/**
 * 移植時要調的東西全在這裡，而且都有預設值——不設任何一個也跑得起來。
 *
 * repo 不在這裡：`gh` 的 `{owner}`／`{repo}` 佔位符會從 cwd 的 git 推斷，要指定別的 repo 就設
 * `GH_REPO`（`gh` 自己的環境變數，fork 與多 remote 的判斷也一併交給它）。
 */
const CONFIG = {
  /** 子票在內文裡指向 parent 的標題。GitHub 原生 sub-issue 有值時優先用原生的。 */
  parentHeading: process.env.ISSUE_MAP_PARENT_HEADING ?? 'Parent',
  /** 掛了就是還沒評估完，不能交給誰做。 */
  unready: labelList(process.env.ISSUE_MAP_LABELS_UNREADY, 'needs-triage,needs-info'),
  /** 掛了才算評估完、可以動工。 */
  ready: labelList(process.env.ISSUE_MAP_LABELS_READY, 'ready-for-agent,ready-for-human'),
  /** 掛了代表有人在做，不必有 assignee。 */
  active: labelList(process.env.ISSUE_MAP_LABELS_ACTIVE, 'in-progress'),
  /** 這些要人做，下一步不寫實作指令。 */
  human: labelList(process.env.ISSUE_MAP_LABELS_HUMAN, 'ready-for-human'),
  /** 可以動工時要跑的指令。搬去沒有這個 skill 的 repo 就換掉，不然圖上會叫人跑不存在的東西。 */
  implementCommand: process.env.ISSUE_MAP_CMD_IMPLEMENT ?? '/implement',
  /** 還要評估時要跑的指令。 */
  triageCommand: process.env.ISSUE_MAP_CMD_TRIAGE ?? '/triage',
} as const

type IssueState = 'OPEN' | 'CLOSED'

type RawIssue = {
  readonly number: number
  readonly title: string
  readonly state: IssueState
  readonly url: string
  readonly body: string
  readonly closedAt: string | null
  /** 開票的人。GitHub 帳號被刪掉的話是 null。 */
  readonly author: { readonly login: string } | null
  /** GitHub 原生的 sub-issue 關係。沒用這套的 repo 一律是 null，改讀內文的標題。 */
  readonly parent: { readonly number: number } | null
  readonly labels: { readonly nodes: readonly { readonly name: string }[] }
  readonly assignees: { readonly nodes: readonly { readonly login: string }[] }
  readonly blockedBy: { readonly nodes: readonly { readonly number: number }[] }
}

/** 一路帶著算好的 parent，免得同一段內文被 regex 掃好幾次。 */
type Issue = RawIssue & { readonly parentNumber: number | null }

interface Connection {
  pageInfo: { hasNextPage: boolean }
  nodes: RawIssue[]
}
interface QueryResult {
  repository: { nameWithOwner: string } & Record<'open' | 'closed', Connection>
}

const FIELDS = `
  pageInfo { hasNextPage }
  nodes {
    number title state url body closedAt
    author { login }
    parent { number }
    labels(first: 20) { nodes { name } }
    assignees(first: 10) { nodes { login } }
    blockedBy(first: 50) { nodes { number } }
  }
`

/** 一次問完 repo 名字與兩種狀態的 issue，只開一個 `gh` 行程。 */
const QUERY = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      nameWithOwner
      open: issues(states: OPEN, first: ${PAGE}, orderBy: { field: CREATED_AT, direction: DESC }) { ${FIELDS} }
      closed: issues(states: CLOSED, first: ${PAGE}, orderBy: { field: CREATED_AT, direction: DESC }) { ${FIELDS} }
    }
  }`

function query(): QueryResult['repository'] {
  // `{owner}`／`{repo}` 由 gh 從 cwd 的 git 推斷，`GH_REPO` 可以蓋過去。
  const result = spawnSync(
    ['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-F', 'owner={owner}', '-F', 'repo={repo}'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) throw new Error(`gh api graphql 失敗：${result.stderr.toString()}`)
  const parsed = JSON.parse(result.stdout.toString()) as { data: QueryResult; errors?: unknown }
  if (parsed.errors) throw new Error(`GraphQL 錯誤：${JSON.stringify(parsed.errors)}`)
  const repository = parsed.data.repository
  if (repository.open.pageInfo.hasNextPage) {
    throw new Error(`open issue 超過 ${PAGE} 張，這支要改成分頁抓`)
  }
  return repository
}

/** 原生 sub-issue 優先；沒有就讀內文的 `## <標題>` 之後第一個 `#<n>`。 */
const PARENT_IN_BODY = new RegExp(`##\\s*${CONFIG.parentHeading}\\s*\\n[\\s\\S]*?#(\\d+)`)
function withParent(raw: RawIssue): Issue {
  const inBody = PARENT_IN_BODY.exec(raw.body)
  return { ...raw, parentNumber: raw.parent?.number ?? (inBody ? Number(inBody[1]) : null) }
}

export function takeSnapshot(): Snapshot {
  const repository = query()
  const open = repository.open.nodes.map(withParent)
  const closed = repository.closed.nodes.map(withParent)

  const openNumbers = new Set(open.map((issue) => issue.number))
  const openParents = new Set(open.map((issue) => issue.parentNumber).filter(isNumber))
  const blockers = new Set(
    open.flatMap((issue) => issue.blockedBy.nodes.map((blocker) => blocker.number)),
  )

  // 只留 open issue 還牽著的 closed issue：當它們的阻擋者、當它們的 parent，或跟它們同一個
  // parent（同一組子票的已完成進度）。沒人牽著之後自然從地圖消失。
  const kept = [
    ...open,
    ...closed.filter(
      (issue) =>
        blockers.has(issue.number) ||
        openParents.has(issue.number) ||
        (issue.parentNumber !== null && openParents.has(issue.parentNumber)),
    ),
  ]
  const parents = new Set(kept.map((issue) => issue.parentNumber).filter(isNumber))
  const openChildren = new Map<number, number>()
  for (const issue of kept) {
    if (issue.parentNumber === null || issue.state !== 'OPEN') continue
    openChildren.set(issue.parentNumber, (openChildren.get(issue.parentNumber) ?? 0) + 1)
  }

  // 這個 repo 到底有沒有在用 triage 標籤。都沒看到就別拿它當閘門，否則每張票都會變成待 triage。
  const seen = new Set(kept.flatMap((issue) => issue.labels.nodes.map((label) => label.name)))
  const triaged = [...CONFIG.unready, ...CONFIG.ready].some((name) => seen.has(name))

  const issues = kept
    .map((raw) => describeIssue(raw, { open: openNumbers, openChildren, parents, triaged }))
    .toSorted((a, b) => a.number - b.number)
  return {
    generatedAt: new Date().toISOString(),
    repo: repository.nameWithOwner,
    labels: { ready: CONFIG.ready, unready: CONFIG.unready },
    groups: groupsOf(issues),
    criticalPath: criticalPathOf(issues),
    issues,
  }
}

function isNumber(value: number | null): value is number {
  return value !== null
}

interface Context {
  readonly open: Set<number>
  /** 每張主票底下還開著的子票。主票的狀態看的是這個，不是自己的阻擋者。 */
  readonly openChildren: Map<number, number>
  readonly parents: Set<number>
  /** 這個 repo 有在用 triage 標籤，狀態才把它們當閘門。 */
  readonly triaged: boolean
}

function describeIssue(raw: Issue, context: Context): MapIssue {
  const labels = raw.labels.nodes.map((label) => label.name)
  const assignees = raw.assignees.nodes.map((assignee) => assignee.login)
  const blockedBy = raw.blockedBy.nodes.map((blocker) => blocker.number)
  // 只有還開著的阻擋者算閘門；GitHub 的 blocked_by 摘要也是這樣算的。
  const waitingFor = blockedBy.filter((number) => context.open.has(number))
  const isParent = context.parents.has(raw.number)
  const has = (names: readonly string[]) => names.some((name) => labels.includes(name))

  function statusOf(): Status {
    if (raw.state === 'CLOSED') return 'done'
    // Parent 自己不做事，看的是子票：還有子票開著就是還在等。
    if (isParent) {
      return waitingFor.length || (context.openChildren.get(raw.number) ?? 0) ? 'blocked' : 'ready'
    }
    // 沒掛角色標籤的票還沒被評估過，不能因為沒人擋它就當成可接手。
    if (context.triaged && (has(CONFIG.unready) || !has(CONFIG.ready))) return 'triage'
    if (assignees.length || has(CONFIG.active)) return 'active'
    return waitingFor.length ? 'blocked' : 'ready'
  }

  function nextStepOf(status: Status): string {
    if (status === 'done') return ''
    if (status === 'triage') return CONFIG.triageCommand
    if (status === 'active') return assignees.join(', ') || CONFIG.active[0] || '進行中'
    if (isParent) {
      const left = context.openChildren.get(raw.number) ?? 0
      return left ? `等 ${left} 張子票關完` : '子票全關，可以關掉了'
    }
    if (status === 'blocked') return `等 ${waitingFor.map((number) => `#${number}`).join(' ')}`
    return has(CONFIG.human) ? '人工實作' : CONFIG.implementCommand
  }

  const status = statusOf()
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    closedAt: raw.closedAt,
    author: raw.author?.login ?? '',
    labels,
    assignees,
    parent: raw.parentNumber,
    blockedBy,
    waitingFor,
    status,
    nextStep: nextStepOf(status),
    isParent,
  }
}

/** 把快照塞進樣板。回傳的是 artifact 用的片段（沒有 doctype／html／head／body）。 */
/**
 * 把畫面那一支打包成一段可以直接放進 `<script>` 的程式碼。
 *
 * 產出必須是**一個檔案**（artifact 的頁面就是一份 HTML），但來源不必——來源是 TypeScript，
 * 所以型別跟這裡共用同一份定義，而且純推導測得到。`format: 'iife'` 是因為它要塞進行內；
 * 不 minify 是因為這是開發用的頁面，讀得懂比小重要。
 */
async function bundleClient(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [CLIENT],
    target: 'browser',
    format: 'iife',
    minify: false,
  })
  if (!built.success) throw new Error(`打包 ${CLIENT} 失敗：${built.logs.join('\n')}`)
  const [output] = built.outputs
  if (!output) throw new Error(`打包 ${CLIENT} 沒有產出`)
  return output.text()
}

export async function renderFragment(snapshot: Snapshot): Promise<string> {
  const template = await Bun.file(TEMPLATE).text()
  const withData = replaceIn(
    template,
    /(<script id="issue-map-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    // JSON 裡把 `<` 一律逃脫成 `\u003c`：那在 JSON 字串裡等價，而且不可能提早關掉 <script>。
    JSON.stringify(snapshot).replaceAll('<', '\\u003c'),
    'issue-map-data',
  )
  return replaceIn(
    withData,
    /(<script id="issue-map-code">)[\s\S]*?(<\/script>)/,
    // 程式碼不能這樣逃脫——`a < b` 會被改壞。只擋真正會提早收尾的那一個序列。
    (await bundleClient()).replace(/<\/script/gi, '<\\/script'),
    'issue-map-code',
  )
}

function replaceIn(html: string, marker: RegExp, body: string, what: string): string {
  const next = html.replace(marker, `$1${body}$2`)
  if (next === html) throw new Error(`樣板缺少 ${what} 區塊：${TEMPLATE}`)
  return next
}

export function describe(snapshot: Snapshot): string {
  const done = snapshot.issues.filter((issue) => issue.status === 'done').length
  return `${snapshot.issues.length - done} 張未完成、${done} 張仍被引用的已完成（${snapshot.generatedAt}）`
}

if (import.meta.main) {
  const snapshot = takeSnapshot()
  await Bun.write(OUTPUT, await renderFragment(snapshot))
  console.log(`已寫入 ${OUTPUT}：${describe(snapshot)}`)
}
