#!/usr/bin/env bun
/**
 * 開發地圖：把 GitHub Issues 的阻擋關係抓下來，塞進 `scripts/issue-map.html` 這份樣板，產出一頁
 * 可以直接看的 HTML。每張票的狀態、在等誰、下一步都在這裡算完才送進頁面，樣板只負責畫。
 *
 * 帶進快照的 issue：所有 open issue，加上仍被 open issue 牽著的 closed issue（畫成「已完成」的
 * 節點讓進度看得見，沒人牽著之後自然消失）。closed 是**指名**去要的——阻擋者、parent、parent
 * 底下的子票，不掃整包，因為老 repo 幾千張 closed 裡通常只有個位數會留下。代價：同一組裡已
 * 完成的兄弟票要靠 GitHub 原生 sub-issue 才抽得到，用內文 `## Parent` 慣例的 repo 看不到它們，
 * 那一組的進度會比實際少。
 *
 * 用法：`bun run scripts/issue-map.ts [out.html]`，預設寫到 `dist/issue-map.html`。
 * 環境變數與設計決定見 README；移植要調的東西在底下的 `CONFIG`。
 */

import { spawnSync } from 'bun'

import { LOCALE_NAME, LOCALES, t } from './issue-map-i18n.ts'
import {
  criticalPathOf,
  groupsOf,
  type MapIssue,
  type NextStep,
  type Snapshot,
  type Status,
} from './issue-map-model.ts'
import { esc, viewOf } from './issue-map-view.ts'

const TEMPLATE = new URL('./issue-map.html', import.meta.url).pathname
const CLIENT = new URL('./issue-map-page.ts', import.meta.url).pathname
const OUTPUT = process.argv[2] ?? 'dist/issue-map.html'

/** 一頁的張數。GraphQL 的 `first` 最多就是 100，票再多就靠 cursor 一頁一頁接。 */
const PAGE = 100
/** 一次用 alias 指名幾張票。GraphQL 對單一查詢的節點數有上限，這個量級離它還很遠。 */
const BATCH = 50

function labelList(raw: string | undefined, fallback: string): readonly string[] {
  return (raw ?? fallback)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

/**
 * 移植時要調的東西全在這裡，而且都有預設值——不設任何一個也跑得起來。
 *
 * repo 不在這裡：那是 `gh` 自己的 `GH_REPO`，fork 與多 remote 的判斷也一併交給它。
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

export type IssueState = 'OPEN' | 'CLOSED'

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

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

/** 票號查不到（號碼其實是 PR，或那張票不存在）時 GraphQL 回 null。 */
type MaybeIssue = RawIssue | null

const ISSUE_FIELDS = `
  number title state url body closedAt
  author { login }
  parent { number }
  labels(first: 20) { nodes { name } }
  assignees(first: 10) { nodes { login } }
  blockedBy(first: 50) { nodes { number } }
`

type GraphQLError = { readonly type?: string; readonly message?: string }

/**
 * 從 `gh api graphql` 的輸出取出 data。
 *
 * **查不到的票不是錯誤。** 指名去要某個票號時，GitHub 會同時回 `data`（那個 alias 是 `null`）
 * 與一筆 `NOT_FOUND`，而 `gh` 為了那筆錯誤以非零離開。號碼其實是 PR、票被轉移或刪掉、內文
 * 慣例掃出來的誤判——在老 repo 上都是常態，一個掃不到就讓整張圖產不出來並不合理。所以只有
 * `NOT_FOUND` 以外的錯誤才拋，資料照用。
 *
 * 連 data 都沒有（沒登入、網路不通）就拿 stderr 當原因拋出去。
 */
export function dataOrThrow<T>(stdout: string, stderr: string): T {
  let parsed: { data?: T; errors?: readonly GraphQLError[] } | undefined
  try {
    parsed = stdout ? (JSON.parse(stdout) as typeof parsed) : undefined
  } catch {
    parsed = undefined
  }
  const fatal = (parsed?.errors ?? []).filter((error) => error.type !== 'NOT_FOUND')
  if (!parsed?.data || fatal.length) {
    const why = fatal.length ? JSON.stringify(fatal) : stderr.trim() || stdout.trim()
    throw new Error(`gh api graphql failed: ${why}`)
  }
  return parsed.data
}

/**
 * 跑一次 `gh api graphql`。
 *
 * 票號是我們自己從前一次結果拿到的整數，直接組進查詢字串；只有 cursor 走變數——它是 API 給的
 * 不透明字串，沒有理由自己去逃脫它。
 */
function run<T>(query: string, variables: Record<string, string> = {}): T {
  // `{owner}`／`{repo}` 由 gh 從 cwd 的 git 推斷，`GH_REPO` 可以蓋過去。
  const args = [
    'gh',
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    'owner={owner}',
    '-F',
    'repo={repo}',
  ]
  for (const [name, value] of Object.entries(variables)) args.push('-f', `${name}=${value}`)
  const result = spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  return dataOrThrow<T>(result.stdout.toString(), result.stderr.toString())
}

const OPEN_QUERY = `
  query($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      nameWithOwner
      issues(states: OPEN, first: ${PAGE}, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ${ISSUE_FIELDS} }
      }
    }
  }`

/** open issue 全部都要，所以一路翻到底——票超過一頁不是錯誤，是常態。 */
function fetchOpen(): { nameWithOwner: string; open: RawIssue[] } {
  type Result = { repository: { nameWithOwner: string; issues: Page<RawIssue> } }
  const open: RawIssue[] = []
  let nameWithOwner = ''
  let after: string | null = null
  for (;;) {
    const variables: Record<string, string> = after ? { after } : {}
    const { repository } = run<Result>(OPEN_QUERY, variables)
    nameWithOwner = repository.nameWithOwner
    open.push(...repository.issues.nodes)
    const { hasNextPage, endCursor } = repository.issues.pageInfo
    if (!hasNextPage || !endCursor) break
    after = endCursor
  }
  return { nameWithOwner, open }
}

/** alias 不能以數字開頭，所以票號前面補一個 `i`。 */
const alias = (number: number) => `i${number}`

function chunks<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/** 指名要哪幾張票，一批 alias 問完。查不到的就當沒有。 */
function fetchByNumber(numbers: readonly number[]): RawIssue[] {
  type Result = { repository: Record<string, MaybeIssue> }
  const found: RawIssue[] = []
  for (const batch of chunks(numbers, BATCH)) {
    const query = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      ${batch.map((number) => `${alias(number)}: issue(number: ${number}) { ${ISSUE_FIELDS} }`).join('\n      ')}
    }
  }`
    const { repository } = run<Result>(query)
    for (const number of batch) {
      const issue = repository[alias(number)]
      if (issue) found.push(issue)
    }
  }
  return found
}

function childrenQuery(parent: number): string {
  return `
  query($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      issue(number: ${parent}) {
        subIssues(first: ${PAGE}, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ISSUE_FIELDS} }
        }
      }
    }
  }`
}

/**
 * 拿這些 parent 底下的子票，為的是把同一組裡**已完成**的兄弟票撈出來當進度。
 *
 * 只有 GitHub 原生 sub-issue 有值；用內文 `## Parent` 慣例的 repo 這裡是空的（檔頭說的那個
 * 代價）。open 的兄弟不必靠這裡，它們本來就在 open 那包。
 */
function fetchChildren(parents: readonly number[]): RawIssue[] {
  type Batch = { repository: Record<string, { subIssues: Page<RawIssue> } | null> }
  type More = { repository: { issue: { subIssues: Page<RawIssue> } | null } }
  const children: RawIssue[] = []
  for (const batch of chunks(parents, BATCH)) {
    const query = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      ${batch
        .map(
          (number) => `${alias(number)}: issue(number: ${number}) {
        subIssues(first: ${PAGE}) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } } }`,
        )
        .join('\n      ')}
    }
  }`
    const { repository } = run<Batch>(query)
    for (const number of batch) {
      const page = repository[alias(number)]?.subIssues
      if (!page) continue
      children.push(...page.nodes)
      // 子票破百的 parent 很罕見，就讓它自己續抓，不為了它把整批都變成分頁查詢。
      let after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
      while (after) {
        const next = run<More>(childrenQuery(number), { after }).repository.issue?.subIssues
        if (!next) break
        children.push(...next.nodes)
        after = next.pageInfo.hasNextPage ? next.pageInfo.endCursor : null
      }
    }
  }
  return children
}

/** 原生 sub-issue 優先；沒有就讀內文的 `## <標題>` 之後第一個 `#<n>`。 */
const PARENT_IN_BODY = new RegExp(`##\\s*${CONFIG.parentHeading}\\s*\\n[\\s\\S]*?#(\\d+)`)
function withParent(raw: RawIssue): Issue {
  const inBody = PARENT_IN_BODY.exec(raw.body)
  return { ...raw, parentNumber: raw.parent?.number ?? (inBody ? Number(inBody[1]) : null) }
}

export function takeSnapshot(): Snapshot {
  const { nameWithOwner, open: rawOpen } = fetchOpen()
  const open = rawOpen.map(withParent)

  const openNumbers = new Set(open.map((issue) => issue.number))
  const openParents = new Set(open.map((issue) => issue.parentNumber).filter(isNumber))
  const blockers = new Set(
    open.flatMap((issue) => issue.blockedBy.nodes.map((blocker) => blocker.number)),
  )

  // 指名去要而不掃整包 closed，理由見檔頭。
  const referenced = [...new Set([...blockers, ...openParents])].filter(
    (number) => !openNumbers.has(number),
  )
  const closed = dedupe([...fetchByNumber(referenced), ...fetchChildren([...openParents])])
    .filter((issue) => issue.state === 'CLOSED' && !openNumbers.has(issue.number))
    .map(withParent)

  const kept = [...open, ...closed]
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
    .map((raw) =>
      describeIssue(raw, { open: openNumbers, openChildren, parents, triaged, rules: CONFIG }),
    )
    .toSorted((a, b) => a.number - b.number)
  return {
    generatedAt: new Date().toISOString(),
    repo: nameWithOwner,
    labels: { ready: CONFIG.ready, unready: CONFIG.unready },
    groups: groupsOf(issues),
    criticalPath: criticalPathOf(issues),
    issues,
  }
}

/** 同一張票可能同時是某人的阻擋者又是某人的兄弟，用票號收斂成一張。 */
function dedupe(issues: readonly RawIssue[]): RawIssue[] {
  return [...new Map(issues.map((issue) => [issue.number, issue])).values()]
}

function isNumber(value: number | null): value is number {
  return value !== null
}

/** 狀態機吃的字彙與指令。`CONFIG` 就是這個形狀，抽出來是為了讓規則本身測得到。 */
export type Rules = Pick<
  typeof CONFIG,
  'unready' | 'ready' | 'active' | 'human' | 'implementCommand' | 'triageCommand'
>

/** 判狀態要用到的、這張票自己的事實。刻意不含標題與網址那些只拿去顯示的欄位。 */
export interface IssueFacts {
  readonly number: number
  readonly state: IssueState
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  /** 全部的阻擋者，含已關掉的。哪些還算閘門由這裡自己濾。 */
  readonly blockedBy: readonly number[]
}

/** 判狀態要用到的、整個 repo 的事實。 */
export interface RepoFacts {
  readonly open: ReadonlySet<number>
  /** 每張主票底下還開著的子票。主票的狀態看的是這個，不是自己的阻擋者。 */
  readonly openChildren: ReadonlyMap<number, number>
  readonly parents: ReadonlySet<number>
  /** 這個 repo 有在用 triage 標籤，狀態才把它們當閘門。 */
  readonly triaged: boolean
  readonly rules: Rules
}

/** 一張票的判定結果。`MapIssue` 其餘欄位都只是把原始資料抄過去。 */
export type Verdict = Pick<MapIssue, 'waitingFor' | 'status' | 'nextStep' | 'isParent'>

/**
 * 這個工具的核心語意：一張票是什麼狀態、在等誰、下一步該做什麼。
 *
 * 純函式——所有輸入都在參數裡，沒有 `gh`、沒有時間、沒有環境變數（字彙走 `rules`）。
 */
export function verdictOf(issue: IssueFacts, repo: RepoFacts): Verdict {
  const { rules } = repo
  // 只有還開著的阻擋者算閘門；GitHub 的 blocked_by 摘要也是這樣算的。
  const waitingFor = issue.blockedBy.filter((number) => repo.open.has(number))
  const isParent = repo.parents.has(issue.number)
  const openChildren = repo.openChildren.get(issue.number) ?? 0
  const has = (names: readonly string[]) => names.some((name) => issue.labels.includes(name))

  function statusOf(): Status {
    if (issue.state === 'CLOSED') return 'done'
    // Parent 自己不做事，看的是子票：還有子票開著就是還在等。
    if (isParent) return waitingFor.length || openChildren ? 'blocked' : 'ready'
    // 沒掛角色標籤的票還沒被評估過，不能因為沒人擋它就當成可接手。
    if (repo.triaged && (has(rules.unready) || !has(rules.ready))) return 'triage'
    if (issue.assignees.length || has(rules.active)) return 'active'
    return waitingFor.length ? 'blocked' : 'ready'
  }

  /** 只算出「是哪一種下一步」。句子是頁面的事，在 `issue-map-i18n.ts` 依語言組出來。 */
  function nextStepOf(status: Status): NextStep {
    if (status === 'done') return { kind: 'none' }
    if (status === 'triage') return { kind: 'command', command: rules.triageCommand }
    if (status === 'active') {
      // 沒有 assignee 但掛了 active 標籤時，能講的就只有那個標籤名。
      const label = rules.active[0]
      return {
        kind: 'active',
        who: issue.assignees.length ? issue.assignees : label ? [label] : [],
      }
    }
    // 主票先講子票；子票全關卻還是 blocked，就是它自己被別的票擋著，那時要講那張票。
    if (isParent && openChildren) return { kind: 'waitChildren', count: openChildren }
    if (status === 'blocked') return { kind: 'waitIssues', issues: waitingFor }
    if (isParent) return { kind: 'parentReady' }
    return has(rules.human)
      ? { kind: 'manual' }
      : { kind: 'command', command: rules.implementCommand }
  }

  const status = statusOf()
  return { waitingFor, status, nextStep: nextStepOf(status), isParent }
}

function describeIssue(raw: Issue, repo: RepoFacts): MapIssue {
  const labels = raw.labels.nodes.map((label) => label.name)
  const assignees = raw.assignees.nodes.map((assignee) => assignee.login)
  const blockedBy = raw.blockedBy.nodes.map((blocker) => blocker.number)
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
    ...verdictOf({ number: raw.number, state: raw.state, labels, assignees, blockedBy }, repo),
  }
}

/**
 * 把畫面那一支打包成一段可以直接放進 `<script>` 的程式碼。
 *
 * 產出必須是一個檔案，但來源不必——來源是 TypeScript，所以型別跟這裡共用同一份定義，而且純
 * 推導測得到。`format: 'iife'` 是因為它要塞進行內；不 minify 是因為這是開發用的頁面。
 */
async function bundleClient(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [CLIENT],
    target: 'browser',
    format: 'iife',
    minify: false,
  })
  if (!built.success) throw new Error(`Failed to bundle ${CLIENT}: ${built.logs.join('\n')}`)
  const [output] = built.outputs
  if (!output) throw new Error(`Bundling ${CLIENT} produced no output`)
  return output.text()
}

/**
 * 把樣板裡某個容器的內容填掉。
 *
 * 樣板裡這些容器都是空的（`<div id="x"></div>`），所以只要在開頭標籤與結尾標籤之間插入即可，
 * 不必真的剖析 HTML。填不到就是樣板被改壞了，直接喊。
 */
function fillById(html: string, id: string, body: string): string {
  // 標籤名要吃得到數字，`h1`、`h2` 都是容器。
  const marker = new RegExp(`(<[a-z][a-z0-9]*[^>]*\\sid="${id}"[^>]*>)(</[a-z][a-z0-9]*>)`)
  const next = html.replace(marker, `$1${body}$2`)
  if (next === html) throw new Error(`Template is missing an empty #${id}: ${TEMPLATE}`)
  return next
}

/**
 * 建置時就把整頁畫好。
 *
 * 標記由 `issue-map-view.ts` 產生，畫面那一支重畫時用的是同一批函式——所以沒有 JS 的環境看到的
 * 是同一份頁面，只是不能互動。少了這一步，擋掉 inline script 的地方（嚴格 CSP、某些預覽窗）
 * 拿到的會是一份空骨架。
 *
 * 預設語言是英文；換語言要有 JS，那本來就不是靜態檔能做的事。
 */
function prerender(html: string, snapshot: Snapshot): string {
  const view = viewOf(snapshot)
  const foot = view.footerHTML()
  const detail = view.detailPanelHTML(view.defaultPick())
  const rows = view.rowsHTML('all')
  const title = view.title()
  const filled: [string, string][] = [
    ['eyebrow', esc(view.eyebrow())],
    ['page-title', esc(title)],
    ['lede', view.lede()],
    ['stats', view.statsHTML()],
    ['detail', detail.html],
    ['groups', view.groupsHTML()],
    ['list-title', esc(t('list.title'))],
    ['list-sub', esc(t('list.count', { n: rows.shown }))],
    ['tabs', view.tabsHTML('all')],
    ['rows', rows.html],
    ['foot-truth', foot.truth],
    ['foot-refresh', foot.refresh],
    ['foot-config', foot.config],
    ['lang', LOCALES.map((l) => `<option value="${l}">${esc(LOCALE_NAME[l])}</option>`).join('')],
  ]
  const withBody = filled.reduce((acc, [id, body]) => fillById(acc, id, body), html)
  return replaceIn(withBody, /(<title>)[\s\S]*?(<\/title>)/, esc(title), 'title')
}

/** 把快照塞進樣板。回傳的是 artifact 用的片段（沒有 doctype／html／head／body）。 */
export async function renderFragment(snapshot: Snapshot): Promise<string> {
  const template = await Bun.file(TEMPLATE).text()
  const withData = replaceIn(
    template,
    /(<script id="issue-map-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    // JSON 裡把 `<` 一律逃脫成 `\u003c`：那在 JSON 字串裡等價，而且不可能提早關掉 <script>。
    JSON.stringify(snapshot).replaceAll('<', '\\u003c'),
    'issue-map-data',
  )
  const withPage = prerender(withData, snapshot)
  return replaceIn(
    withPage,
    /(<script id="issue-map-code">)[\s\S]*?(<\/script>)/,
    // 程式碼不能這樣逃脫——`a < b` 會被改壞。只擋真正會提早收尾的那一個序列。
    (await bundleClient()).replace(/<\/script/gi, '<\\/script'),
    'issue-map-code',
  )
}

/**
 * 把片段包成一份完整文件。**直接開檔案看的一律走這裡**：少了 doctype 瀏覽器會進 quirks mode。
 * charset 是防禦性的——從 `file://` 開沒有 header 可依靠，而這一頁帶著四種語言的文案。
 *
 * `lang` 是預設語言；頁面上換語言時畫面那一支會改掉 `documentElement.lang`。
 */
export async function renderDocument(snapshot: Snapshot): Promise<string> {
  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  return `<!doctype html><html lang="en"><head>${head}</head><body>${await renderFragment(snapshot)}</body></html>`
}

function replaceIn(html: string, marker: RegExp, body: string, what: string): string {
  const next = html.replace(marker, `$1${body}$2`)
  if (next === html) throw new Error(`Template is missing the ${what} block: ${TEMPLATE}`)
  return next
}

export function describe(snapshot: Snapshot): string {
  const done = snapshot.issues.filter((issue) => issue.status === 'done').length
  return `${snapshot.issues.length - done} unfinished, ${done} closed but still referenced (${snapshot.generatedAt})`
}

if (import.meta.main) {
  const snapshot = takeSnapshot()
  await Bun.write(OUTPUT, await renderDocument(snapshot))
  console.log(`Wrote ${OUTPUT}: ${describe(snapshot)}`)
}
