/**
 * 開發地圖的形狀與純推導。**沒有 Bun、沒有 DOM**——抓資料的那一側（`issue-map.ts`）與畫面
 * 那一側（`issue-map-page.ts`）都 import 它，所以它不能碰任何一邊的專屬 API。
 *
 * 這裡住的是「同一份定義只有一份」的東西：狀態的五個值、一張票的形狀、分群規則、關鍵路徑，
 * 以及線路圖的排版。畫面那一側曾經把狀態的五個值再抄一次，兩邊沒有東西保證同步；現在型別
 * 是共用的，抄錯編不過。
 */

/** 一張票現在的處境。同時是頁面的顏色與篩選分頁。 */
export type Status = 'ready' | 'active' | 'blocked' | 'triage' | 'done'

/** 五個狀態的顯示順序，也是清單的排序權重。 */
export const STATUS_ORDER: readonly Status[] = ['ready', 'active', 'blocked', 'triage', 'done']

/**
 * 下一步。**這裡只放事實，不放句子**——「等 3 張子票關完」這種話由 `issue-map-i18n.ts` 依當下
 * 語言組出來。快照裡存中文句子的話，換語言就得重抓一次 GitHub。
 *
 * `command` 的內容是設定（`/implement`、`/triage`），不是文案，所以照原字帶著走。
 */
export type NextStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'manual' }
  /** 有人接手。`who` 是 assignee，沒有 assignee 但掛了 active 標籤時是那個標籤名。 */
  | { readonly kind: 'active'; readonly who: readonly string[] }
  | { readonly kind: 'waitIssues'; readonly issues: readonly number[] }
  | { readonly kind: 'waitChildren'; readonly count: number }
  | { readonly kind: 'parentReady' }

/** 頁面吃的形狀。這裡是它唯一的定義。 */
export type MapIssue = {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly closedAt: string | null
  /** 開票的人。帳號已刪除時是空字串。 */
  readonly author: string
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  readonly parent: number | null
  /** 全部的阻擋者，含已關掉的——頁面要畫出「已解鎖的前置」。 */
  readonly blockedBy: readonly number[]
  /** 還開著的阻擋者，就是實際的閘門。 */
  readonly waitingFor: readonly number[]
  readonly status: Status
  /** 下一步。句子在 i18n 那一層才組出來。 */
  readonly nextStep: NextStep
  /** 有子票的票。它自己不做事，等子票全關。 */
  readonly isParent: boolean
}

/**
 * 一群票的名字。`spec` 帶的是主票標題——那是真資料，不翻；另外三種是頁面自己的分類，翻譯在
 * i18n 那一層。
 */
export type GroupName =
  | { readonly kind: 'spec'; readonly title: string }
  /** 主票沒被帶進快照，只好用票號稱呼這一群。 */
  | { readonly kind: 'orphan'; readonly parent: number }
  | { readonly kind: 'linked' }
  | { readonly kind: 'island' }

/** 畫在同一張圖上的一群票。 */
export type Group = {
  /** 有 parent 的群就是那張主票；沒有的是「其他依賴鏈」與「獨立票」這兩種。 */
  readonly parent: number | null
  readonly name: GroupName
  readonly members: readonly number[]
}

export type Snapshot = {
  readonly generatedAt: string
  readonly repo: string
  /** 這一次實際生效的標籤字彙。圖例照它寫，不然改了設定圖例就會說謊。 */
  readonly labels: { readonly ready: readonly string[]; readonly unready: readonly string[] }
  /** 一張圖一群。 */
  readonly groups: readonly Group[]
  /** 最長的一條依序未完成鏈，也就是最少要幾輪。 */
  readonly criticalPath: number
  readonly issues: readonly MapIssue[]
}

/**
 * 分群：同一張主票底下的子票一群；沒有主票但跟別人有前置關係的合成一群；完全孤立的合成一群。
 * 一張圖畫一群。
 */
export function groupsOf(issues: readonly MapIssue[]): Group[] {
  const known = new Set(issues.map((issue) => issue.number))
  const blocking = new Set(issues.flatMap((issue) => issue.blockedBy))
  const byParent = new Map<number, number[]>()
  for (const issue of issues) {
    if (issue.parent === null) continue
    const siblings = byParent.get(issue.parent) ?? []
    siblings.push(issue.number)
    byParent.set(issue.parent, siblings)
  }

  const groups: Group[] = []
  for (const [parent, members] of byParent) {
    const spec = issues.find((issue) => issue.number === parent)
    const name: GroupName = spec ? { kind: 'spec', title: spec.title } : { kind: 'orphan', parent }
    groups.push({ parent, name, members })
  }

  const grouped = new Set([...byParent.values()].flat())
  const linked: number[] = []
  const alone: number[] = []
  for (const issue of issues) {
    if (grouped.has(issue.number) || issue.isParent) continue
    const hasEdge = blocking.has(issue.number) || issue.blockedBy.some((n) => known.has(n))
    ;(hasEdge ? linked : alone).push(issue.number)
  }
  if (linked.length) groups.push({ parent: null, name: { kind: 'linked' }, members: linked })
  if (alone.length) groups.push({ parent: null, name: { kind: 'island' }, members: alone })
  return groups
}

/** DAG 裡從來源算起的最長路徑。環在資料裡不該有，真的有就當它走到底。 */
function longestPath(
  start: number,
  predecessorsOf: (n: number) => readonly number[],
  memo: Map<number, number>,
): number {
  function walk(n: number, seen: Set<number>): number {
    const cached = memo.get(n)
    if (cached !== undefined) return cached
    if (seen.has(n)) return 0
    seen.add(n)
    let best = 0
    for (const previous of predecessorsOf(n)) best = Math.max(best, walk(previous, seen))
    memo.set(n, best + 1)
    return best + 1
  }
  return walk(start, new Set())
}

/** 最長的一條依序未完成鏈。 */
export function criticalPathOf(issues: readonly MapIssue[]): number {
  const waiting = new Map(issues.map((issue) => [issue.number, issue.waitingFor]))
  const memo = new Map<number, number>()
  let longest = 0
  for (const issue of issues) {
    if (issue.status === 'done') continue
    longest = Math.max(
      longest,
      longestPath(issue.number, (n) => waiting.get(n) ?? [], memo),
    )
  }
  return longest
}

/** 線路圖的尺寸。改這裡就會同時改到排版與 SVG 的畫布大小。 */
export const MAP = {
  /** 左邊留給線名，也讓第一站的名字不會壓到它。 */
  gutter: 96,
  /** 站與站的水平距離。 */
  step: 108,
  /** 線與線的垂直距離。 */
  row: 72,
  /** 第一條線離上緣。 */
  top: 26,
  /** 站點的半徑。 */
  dot: 7,
  /** 跨線轉折的圓角。 */
  bend: 12,
  /** 最後一站的名字會往右伸出去，畫布要留得下。 */
  rightPad: 46,
} as const

export type Point = { readonly x: number; readonly y: number }
export type Edge = { readonly from: number; readonly to: number }

export type Layout = {
  /** 每一條線由前到後的站。只有一站的線不標線名。 */
  readonly tracks: readonly (readonly number[])[]
  /** 孤立的票排成幾列月台。 */
  readonly islandRows: number
  /** 月台從第幾列開始。 */
  readonly islandFrom: number
  readonly xy: ReadonlyMap<number, Point>
  readonly edges: readonly Edge[]
  readonly width: number
  readonly height: number
}

/**
 * 把一組票排成線路圖。
 *
 * x 由整張圖的 level 決定（前置在左），y 由票屬於哪一條線決定。所有邊因此一律向右，跨線的邊
 * 只需要一個直角轉折。
 *
 * 真的有前置關係的票才排成線：每次挑最長的一條鏈當一條線，挑完移除再挑下一條。組裡完全沒有
 * 前置關係的票（既不擋人也不被擋）不算線，打包成一片月台橫排——不然一組十二張互不相干的票
 * 會變成十二條單站線。
 */
export function layoutOf(members: readonly MapIssue[]): Layout {
  const inGroup = new Set(members.map((m) => m.number))
  const preds = new Map(
    members.map((m) => [m.number, m.blockedBy.filter((n) => inGroup.has(n))] as const),
  )
  const predsOf = (n: number): readonly number[] => preds.get(n) ?? []

  const hasEdge = new Set<number>()
  for (const m of members) {
    for (const from of predsOf(m.number)) {
      hasEdge.add(m.number)
      hasEdge.add(from)
    }
  }
  const wired = members.filter((m) => hasEdge.has(m.number))
  const island = members.filter((m) => !hasEdge.has(m.number))

  const level = new Map<number, number>()
  for (const m of wired) longestPath(m.number, predsOf, level)
  const levelOf = (n: number) => level.get(n) ?? 1
  const deeperFirst = (a: number, b: number) => levelOf(b) - levelOf(a)

  const left = new Set(wired.map((m) => m.number))
  const tracks: number[][] = []
  while (left.size) {
    const tail = [...left].sort((a, b) => deeperFirst(a, b) || a - b)[0] as number
    const chain = [tail]
    for (let at = tail; ;) {
      const back = predsOf(at)
        .filter((n) => left.has(n))
        .sort(deeperFirst)[0]
      if (back === undefined) break
      chain.unshift(back)
      at = back
    }
    for (const n of chain) left.delete(n)
    tracks.push(chain)
  }

  const depth = wired.length ? Math.max(...wired.map((m) => levelOf(m.number))) : 1
  const perRow = Math.max(depth, 4)
  const xy = new Map<number, Point>()
  tracks.forEach((chain, index) => {
    for (const n of chain) {
      xy.set(n, { x: MAP.gutter + (levelOf(n) - 1) * MAP.step, y: MAP.top + index * MAP.row })
    }
  })
  island.forEach((m, index) => {
    xy.set(m.number, {
      x: MAP.gutter + (index % perRow) * MAP.step,
      y: MAP.top + (tracks.length + Math.floor(index / perRow)) * MAP.row,
    })
  })
  const islandRows = Math.ceil(island.length / perRow)

  const edges: Edge[] = []
  for (const m of members) {
    for (const from of predsOf(m.number)) edges.push({ from, to: m.number })
  }

  return {
    tracks,
    islandRows,
    islandFrom: tracks.length,
    xy,
    edges,
    width: MAP.gutter + perRow * MAP.step + MAP.rightPad,
    height: MAP.top + (tracks.length + islandRows) * MAP.row,
  }
}
