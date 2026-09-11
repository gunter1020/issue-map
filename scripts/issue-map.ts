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

import {
  criticalPathOf,
  groupsOf,
  type MapIssue,
  type NextStep,
  type Snapshot,
  type Status,
} from './issue-map-model.ts'

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
  if (result.exitCode !== 0) throw new Error(`gh api graphql failed: ${result.stderr.toString()}`)
  const parsed = JSON.parse(result.stdout.toString()) as { data: T; errors?: unknown }
  if (parsed.errors) throw new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`)
  return parsed.data
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
    .map((raw) => describeIssue(raw, { open: openNumbers, openChildren, parents, triaged }))
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

  /** 只算出「是哪一種下一步」。句子是頁面的事，在 `issue-map-i18n.ts` 依語言組出來。 */
  function nextStepOf(status: Status): NextStep {
    if (status === 'done') return { kind: 'none' }
    if (status === 'triage') return { kind: 'command', command: CONFIG.triageCommand }
    if (status === 'active') {
      // 沒有 assignee 但掛了 active 標籤時，能講的就只有那個標籤名。
      const label = CONFIG.active[0]
      return { kind: 'active', who: assignees.length ? assignees : label ? [label] : [] }
    }
    if (isParent) {
      const left = context.openChildren.get(raw.number) ?? 0
      return left ? { kind: 'waitChildren', count: left } : { kind: 'parentReady' }
    }
    if (status === 'blocked') return { kind: 'waitIssues', issues: waitingFor }
    return has(CONFIG.human)
      ? { kind: 'manual' }
      : { kind: 'command', command: CONFIG.implementCommand }
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

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}
const esc = (text: string) => text.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c] ?? c)

/** 下一步在後備內容裡只寫得出一句話，不像頁面那樣分語言。 */
function nextStepText(step: NextStep): string {
  switch (step.kind) {
    case 'none':
      return '—'
    case 'command':
      return step.command
    case 'manual':
      return 'needs a person'
    case 'active':
      return step.who.length ? `with ${step.who.join(', ')}` : 'someone is on it'
    case 'waitIssues':
      return `waiting on ${step.issues.map((n) => `#${n}`).join(', ')}`
    case 'waitChildren':
      return `waiting on ${step.count} sub-issue(s)`
    case 'parentReady':
      return 'sub-issues all closed'
  }
}

/**
 * 沒有 JS 時看到的內容。
 *
 * **不能用 `<noscript>`：** CSP 擋掉 inline script 時瀏覽器仍認為 scripting 是開的，那個標籤
 * 不會顯示。所以這塊預設就在頁面上，由畫面那一支跑起來後移除。
 *
 * 只有英文，跟 CLI 訊息一致——要換語言本來就得有 JS。
 */
function fallbackHTML(snapshot: Snapshot): string {
  const rows = snapshot.issues
    .map(
      (issue) => `        <tr>
          <td class="num"><a href="${esc(issue.url)}">#${issue.number}</a></td>
          <td>${esc(issue.title)}</td>
          <td>${issue.status}</td>
          <td>${esc(nextStepText(issue.nextStep))}</td>
        </tr>`,
    )
    .join('\n')
  return `
  <h1>${esc(snapshot.repo)} dev map</h1>
  <p class="why">Snapshot of ${esc(snapshot.generatedAt)}. This plain listing is what shows when
  scripts cannot run. Open the file in a browser for the map, the critical path and the filters.</p>
  <table>
    <thead><tr><th>Issue</th><th>Title</th><th>Status</th><th>Next step</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
`
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
  const withFallback = replaceIn(
    withData,
    /(<div id="fallback">)[\s\S]*?(<\/div>)/,
    fallbackHTML(snapshot),
    'fallback',
  )
  return replaceIn(
    withFallback,
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
