/**
 * 開發地圖的畫面。`issue-map.ts` 用 `Bun.build` 把這支打包成一段 script 塞進樣板，所以它
 * **只能碰瀏覽器的東西**，不能 import Bun 的 API。
 *
 * 形狀與純推導在 `issue-map-model.ts`：狀態的五個值、票的形狀、分群、關鍵路徑、線路圖的排版
 * 都在那邊，兩側共用同一份定義。這裡剩下的是 DOM、事件與收合狀態。
 */

import {
  layoutOf,
  MAP,
  type Edge,
  type Group,
  type Layout,
  type MapIssue,
  type Point,
  type Snapshot,
  STATUS_LABEL,
  STATUS_ORDER,
  type Status,
} from './issue-map-model.ts'

// ---- 資料 ----

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 樣板保證這些節點存在。找不到就是樣板被改壞了，早點喊比畫出半張圖好。 */
function pick(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`樣板缺少 #${id}`)
  return node
}

const raw = JSON.parse(pick('issue-map-data').textContent || '{}') as Partial<Snapshot>
const issues: readonly MapIssue[] = raw.issues ?? []
const byNumber = new Map(issues.map((issue) => [issue.number, issue]))
const work = issues.filter((issue) => !issue.isParent)
const criticalPath = raw.criticalPath ?? 0
const repo = raw.repo ?? ''

const counts = Object.fromEntries(
  STATUS_ORDER.map((status) => [status, work.filter((i) => i.status === status).length]),
) as Record<Status, number>
const openCount = work.length - counts.done

/** 誰擋著誰的反向索引。亮鏈與「關掉後解鎖」都用它。 */
const unlocks = new Map<number, number[]>()
for (const issue of issues) {
  for (const blocker of issue.blockedBy) {
    const dependents = unlocks.get(blocker) ?? []
    dependents.push(issue.number)
    unlocks.set(blocker, dependents)
  }
}

function byStatusThenNumber(a: MapIssue, b: MapIssue): number {
  return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.number - b.number
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c)
}

/**
 * 站名就是標題開頭。刻意不另設一個「短名」欄位——那要每張票靠人維護，而且會變成票名的第二個
 * 來源，改了標題不會跟著改。截到讀不通的時候，滑鼠停留與下面的清單都有完整標題。
 */
const HEAD_CHARS = 7

function head(title: string): string {
  return title.length > HEAD_CHARS ? `${title.slice(0, HEAD_CHARS)}…` : title
}

function issueAt(number: number): MapIssue | undefined {
  return byNumber.get(number)
}

// ---- 收合狀態 ----

/**
 * 收合狀態只有一份，地圖與清單都讀它、都能改它。每個瀏覽器記自己的；讀不到（無痕、封鎖）
 * 就當成全部展開。
 */
const COLLAPSE_KEY = `issue-map:collapsed:${repo}`
const onFold: (() => void)[] = []

function readFolded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

const folded = readFolded()

function isFolded(parent: number): boolean {
  return folded.has(String(parent))
}

function setFolded(parent: number, shut: boolean): void {
  if (shut) folded.add(String(parent))
  else folded.delete(String(parent))
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...folded]))
  } catch {
    // 存不了就只在這一次有效，畫面照樣能開合。
  }
  for (const repaint of onFold) repaint()
}

/** 做一顆收合鈕。`parent` 是主票號碼，同一個號碼的鈕與清單列連動。 */
function foldButton(parent: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'fold'
  const paint = () => {
    const open = !isFolded(parent)
    button.setAttribute('aria-expanded', String(open))
    button.setAttribute('aria-label', `${open ? '收起' : '展開'} #${parent} 的子票`)
    button.textContent = open ? '−' : '+'
  }
  paint()
  onFold.push(paint)
  button.addEventListener('click', () => setFolded(parent, !isFolded(parent)))
  return button
}

/** 收合只在這裡畫一次：列、就地展開的細節、地圖本體，凡是掛了 data-parent 的都聽它。 */
function paintFolded(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-parent]')) {
    node.hidden = isFolded(Number(node.dataset.parent))
  }
  for (const section of document.querySelectorAll<HTMLElement>('section.group[data-fold]')) {
    section.dataset.folded = String(isFolded(Number(section.dataset.fold)))
  }
}

// ---- 抬頭 ----

function renderHeader(): void {
  const stats = pick('stats')
  const tiles: { label: string; value: number; unit?: string; tone?: string }[] = [
    { label: '現在可動', value: counts.ready, tone: 'ready' },
    { label: '有人接手', value: counts.active, tone: 'active' },
    { label: '被前置擋住', value: counts.blocked, unit: `/ ${openCount}`, tone: 'blocked' },
    { label: '規格未定案', value: counts.triage, tone: 'triage' },
    { label: '關鍵路徑', value: criticalPath, unit: '張' },
  ]
  for (const tile of tiles) {
    const box = document.createElement('div')
    box.className = 'stat'
    if (tile.tone) box.dataset.tone = tile.tone
    const unit = tile.unit ? `<small>${tile.unit}</small>` : ''
    box.innerHTML = `<b>${tile.value}${unit}</b><span>${tile.label}</span>`
    stats.appendChild(box)
  }

  // 抬頭全部照資料寫，換 repo 或換標籤字彙才不會留著上一個專案的字。
  const heading = `${repo.split('/').pop() || '開發地圖'} 開發地圖`
  pick('page-title').textContent = heading
  document.title = heading
  const when = raw.generatedAt
    ? ` · ${new Date(raw.generatedAt).toLocaleString('zh-TW', { hour12: false })}`
    : ''
  pick('eyebrow').textContent = repo + when

  pick('lede').innerHTML = lede()

  const vocab = raw.labels ?? { ready: [], unready: [] }
  pick('foot-config').textContent = vocab.ready.length
    ? `這一次的判準：掛 ${vocab.ready.join(' 或 ')} 才算可動；掛 ${vocab.unready.join('／')} 或沒掛角色標籤算未定案。`
    : '這個 repo 沒有在用 triage 標籤，狀態只看阻擋與接手。'
}

/** 導言只講數得出來的事實。沒有可動的票、或整批都關完了，句子跟著換。 */
function lede(): string {
  if (!openCount) return '這個 repo 沒有未完成的票。'
  const frontline = work.filter((i) => i.status === 'ready').sort(byStatusThenNumber)
  const parts = [`${openCount} 張未完成。`]
  if (frontline.length) {
    const first = frontline
      .slice(0, 3)
      .map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener">#${i.number}</a>`)
      .join('、')
    parts.push(`<strong>現在可動 ${frontline.length} 張，最前面是 ${first}</strong>。`)
  } else {
    parts.push('<strong>現在沒有可動的票</strong>——每一張都在等前置或等 triage。')
  }
  if (counts.blocked) parts.push(`${counts.blocked} 張被前置擋住。`)
  if (counts.triage) parts.push(`${counts.triage} 張規格還沒定案，要先 triage。`)
  if (criticalPath > 1) parts.push(`關鍵路徑 ${criticalPath} 張，那是最少要幾輪才收得完。`)
  return parts.join(' ')
}

// ---- 線路圖 ----

/**
 * 同一條線就是一橫。跨線走「向右、轉、向下、轉、向右」，而垂直那一段刻意走在站與站之間的
 * 間隙裡——走中點的話會壓到中間那幾條線的站名。同一個終點有多條邊時各自錯開一點，不然它們
 * 會完全重疊成一條。
 */
function railPath(a: Point, b: Point, nudge: number): string {
  const x1 = a.x + MAP.dot + 3
  const x2 = b.x - MAP.dot - 5
  if (a.y === b.y) return `M${x1} ${a.y} H${x2}`
  const gap = Math.max(x1 + MAP.bend + 2, b.x - MAP.step * 0.44 + nudge * 7)
  const turn = Math.min(gap, x2 - MAP.bend - 2)
  const dir = b.y > a.y ? 1 : -1
  return (
    `M${x1} ${a.y} H${turn - MAP.bend}` +
    ` Q${turn} ${a.y} ${turn} ${a.y + dir * MAP.bend}` +
    ` V${b.y - dir * MAP.bend}` +
    ` Q${turn} ${b.y} ${turn + MAP.bend} ${b.y}` +
    ` H${x2}`
  )
}

function svgTag(tag: string, attrs: Readonly<Record<string, string | number>>): string {
  const pairs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  return `<${tag} ${pairs}/>`
}

/**
 * 站點用形狀分辨，不只靠線條粗細——粗細在 7px 的圓點上分不出來。
 *
 * 圓是流程上的票（實心已關、空心等前置、靶心加光暈是現在可動），三角是有人在做，菱形是規格
 * 還沒定案。兩個例外各給一個形狀，掃一眼就分得開。
 */
function stationShape(status: Status, q: Point): string {
  if (status === 'active') {
    // 往右指的三角形：這一站正在往下一站走。
    const r = MAP.dot + 1.5
    const d = `M${q.x - r * 0.72} ${q.y - r} L${q.x + r * 0.86} ${q.y} L${q.x - r * 0.72} ${q.y + r} Z`
    return svgTag('path', { class: 'mark', d })
  }
  if (status === 'triage') {
    const d = MAP.dot + 1
    return svgTag('rect', {
      class: 'mark',
      x: q.x - d,
      y: q.y - d,
      width: d * 2,
      height: d * 2,
      rx: 1,
      transform: `rotate(45 ${q.x} ${q.y})`,
    })
  }
  const dot = svgTag('circle', {
    class: 'mark',
    cx: q.x,
    cy: q.y,
    r: status === 'ready' ? MAP.dot + 2 : MAP.dot,
  })
  if (status !== 'ready') return dot
  return (
    svgTag('circle', { class: 'halo', cx: q.x, cy: q.y, r: MAP.dot + 7 }) +
    dot +
    svgTag('circle', { class: 'core', cx: q.x, cy: q.y, r: 3 })
  )
}

/** 一群票對應的一張圖。`members` 是票，`track` 是這一組的線色。 */
type Shown = { group: Group; members: readonly MapIssue[]; track: string }

function trackLabel(svg: SVGSVGElement, y: number, name: string, sub: string): void {
  const main = document.createElementNS(SVG_NS, 'text')
  main.setAttribute('class', 'tname')
  main.setAttribute('x', '8')
  main.setAttribute('y', String(y - 3))
  main.textContent = name
  svg.appendChild(main)
  const note = document.createElementNS(SVG_NS, 'text')
  note.setAttribute('class', 'tsub')
  note.setAttribute('x', '8')
  note.setAttribute('y', String(y + 12))
  note.textContent = sub
  svg.appendChild(note)
}

function railFor(edge: Edge, layout: Layout, nudge: number): SVGPathElement | null {
  const a = layout.xy.get(edge.from)
  const b = layout.xy.get(edge.to)
  if (!a || !b) return null
  const rail = document.createElementNS(SVG_NS, 'path')
  rail.setAttribute('class', 'edge')
  rail.setAttribute('d', railPath(a, b, nudge))
  rail.dataset.from = String(edge.from)
  rail.dataset.to = String(edge.to)
  rail.dataset.done = String(issueAt(edge.from)?.status === 'done')
  return rail
}

function stationFor(issue: MapIssue, q: Point): SVGAElement {
  const station = document.createElementNS(SVG_NS, 'a')
  station.setAttribute('class', 'node')
  station.setAttribute('href', issue.url)
  station.setAttribute('target', '_blank')
  station.setAttribute('rel', 'noopener')
  station.setAttribute(
    'aria-label',
    `#${issue.number} ${issue.title}，${STATUS_LABEL[issue.status]}`,
  )
  station.dataset.status = issue.status
  station.dataset.number = String(issue.number)
  station.innerHTML =
    stationShape(issue.status, q) +
    `<text class="sid" x="${q.x}" y="${q.y - 15}" text-anchor="middle">#${issue.number}</text>` +
    `<text class="sdesc" x="${q.x}" y="${q.y + 24}" text-anchor="middle">${esc(head(issue.title))}</text>` +
    `<title>#${issue.number} ${esc(issue.title)}</title>`
  // 點站看詳細；要開 GitHub 用 ⌘／Ctrl 點，或詳細面板裡的連結。
  station.addEventListener('click', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return
    ev.preventDefault()
    ev.stopPropagation()
    // 再點同一站就取消，跟點空白處一樣——不然亮起來之後只剩 Esc 能收，那沒人找得到。
    if (selected === issue.number) clearSelection()
    else select(issue.number)
  })
  return station
}

function mapFor(shown: Shown): HTMLDivElement {
  const layout = layoutOf(shown.members)
  const wrap = document.createElement('div')
  wrap.className = 'map-wrap'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', String(layout.width))
  svg.setAttribute('height', String(layout.height))
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
  svg.setAttribute('role', 'img')
  svg.style.setProperty('--track', shown.track)

  // 線名就是終點站的票號。單站線沒有「這條線在做什麼」可講，不標。
  layout.tracks.forEach((chain, index) => {
    const terminus = chain[chain.length - 1]
    if (chain.length < 2 || terminus === undefined) return
    trackLabel(svg, MAP.top + index * MAP.row, `→ #${terminus}`, `${chain.length} 站`)
  })
  if (layout.islandRows) {
    trackLabel(svg, MAP.top + layout.islandFrom * MAP.row, '無前置', '可各自開工')
  }

  const seenTo = new Map<number, number>()
  for (const edge of layout.edges) {
    const nth = seenTo.get(edge.to) ?? 0
    seenTo.set(edge.to, nth + 1)
    const rail = railFor(edge, layout, nth)
    if (rail) svg.appendChild(rail)
  }

  for (const member of shown.members) {
    const q = layout.xy.get(member.number)
    if (q) svg.appendChild(stationFor(member, q))
  }

  // 點圖上的空白處就取消亮線。
  svg.addEventListener('click', (ev) => {
    const target = ev.target
    if (target instanceof Element && target.closest('.node')) return
    clearSelection()
  })
  wrap.appendChild(svg)
  return wrap
}

/** 每張圖底下重複一份 key。圖可以收起來，key 跟著收，不會留一段沒有圖的說明。 */
function mapKey(): HTMLDivElement {
  const key = document.createElement('div')
  key.className = 'map-key'
  key.innerHTML =
    '<span><i class="k-ready"></i>現在可動</span>' +
    '<span><i class="k-active"></i>有人接手</span>' +
    '<span><i class="k-blocked"></i>等前置</span>' +
    '<span><i class="k-triage"></i>規格未定案</span>' +
    '<span><i class="k-done"></i>已關閉</span>' +
    '<span>實線＝還沒解開的前置</span>' +
    '<span>虛線＝前置已關</span>'
  return key
}

const TRACK_COLOURS = ['--t1', '--t2', '--t3', '--t4']

function renderGroups(): void {
  const groupsEl = pick('groups')
  const shownGroups: Shown[] = (raw.groups ?? []).map((group, index) => ({
    group,
    members: group.members.map(issueAt).filter((issue): issue is MapIssue => issue !== undefined),
    track: `var(${TRACK_COLOURS[index % TRACK_COLOURS.length]})`,
  }))

  for (const shown of shownGroups) {
    const section = document.createElement('section')
    section.className = 'group'
    section.style.setProperty('--track', shown.track)

    const header = document.createElement('div')
    header.className = 'group-head'
    header.innerHTML = `<h2>${esc(shown.group.title)}</h2><span class="sub">${groupSub(shown)}</span>`
    section.appendChild(header)

    const body = mapFor(shown)
    section.appendChild(body)
    section.appendChild(mapKey())

    // 主票的子票群可以收起來。獨立票沒有主票，不給收合。
    const parent = shown.group.parent
    if (parent !== null) {
      header.insertBefore(foldButton(parent), header.firstChild)
      section.dataset.fold = String(parent)
      body.dataset.parent = String(parent)
    }
    groupsEl.appendChild(section)
  }
}

function groupSub(shown: Shown): string {
  const parent = shown.group.parent
  if (parent === null) return '互不阻擋，可各自開工'
  const done = shown.members.filter((m) => m.status === 'done').length
  const spec = issueAt(parent)
  const specLink = spec
    ? `<a href="${esc(spec.url)}" target="_blank" rel="noopener">#${parent} parent spec</a> · `
    : ''
  return `${specLink}子票 ${done} / ${shown.members.length} 已完成 · 全關後才關 parent`
}

// ---- 詳細 ----

/**
 * 等誰那一欄只列前幾張。一張主票可以等十幾張子票，全列出來會把整欄撐到把標題壓扁——完整
 * 清單放 title，看得到也不爆版。
 */
const BLOCKERS_SHOWN = 4

function hash(n: number): string {
  return `#${n}`
}

function blockers(list: readonly number[]): string {
  if (!list.length) return '—'
  if (list.length <= BLOCKERS_SHOWN) return list.map(hash).join(' ')
  const rest = list.length - BLOCKERS_SHOWN
  return `${list.slice(0, BLOCKERS_SHOWN).map(hash).join(' ')} <span class="more">+${rest}</span>`
}

function link(n: number): string {
  const issue = issueAt(n)
  return issue ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">#${n}</a>` : `#${n}`
}

function pill(issue: MapIssue): string {
  return `<span class="pill" data-status="${issue.status}">${STATUS_LABEL[issue.status]}</span>`
}

/**
 * 下一步是斜線指令的時候做成按鈕，按了把「指令 ＋ 票號」整句複製走——真正要貼進去的是那一
 * 整句，只顯示指令的話還得自己補票號。不是指令的（接手的人、等哪幾張）就純文字。
 */
function stepCell(issue: MapIssue): string {
  if (!issue.nextStep) return '<span class="next">—</span>'
  if (!issue.nextStep.startsWith('/')) return `<span class="next">${esc(issue.nextStep)}</span>`
  const command = `${issue.nextStep} #${issue.number}`
  return (
    `<button type="button" class="copy" data-copy="${esc(command)}" title="複製 ${esc(command)}">` +
    `<span class="copy-text">${esc(issue.nextStep)}</span></button>`
  )
}

/** 一張票的細節。上面的面板與清單裡展開的那一列共用同一份標記。 */
function detailHTML(number: number): string {
  const issue = issueAt(number)
  if (!issue) return ''
  const settled = issue.blockedBy.filter((b) => !issue.waitingFor.includes(b))
  const opens = (unlocks.get(number) ?? []).filter((n) => issueAt(n)?.status !== 'done')
  const closed = issue.closedAt
    ? ` ${new Date(issue.closedAt).toLocaleDateString('zh-TW')} 關閉`
    : ''
  const rows: [string, string][] = [
    ['狀態', pill(issue) + closed],
    ['下一步', stepCell(issue)],
  ]
  if (issue.author) rows.push(['開票', esc(issue.author)])
  if (issue.parent !== null) rows.push(['Parent', link(issue.parent)])
  if (issue.waitingFor.length) rows.push(['等誰', issue.waitingFor.map(link).join(' ')])
  if (settled.length) rows.push(['已解鎖的前置', settled.map(link).join(' ')])
  if (opens.length) rows.push(['關掉後解鎖', opens.map(link).join(' ')])
  if (issue.labels.length) {
    rows.push(['標籤', issue.labels.map((l) => `<span class="label">${esc(l)}</span>`).join('')])
  }
  if (issue.assignees.length) rows.push(['接手', esc(issue.assignees.join(', '))])
  return (
    `<h3><span class="num">#${issue.number}</span>${esc(issue.title)}</h3>` +
    `<a class="open" href="${esc(issue.url)}" target="_blank" rel="noopener">在 GitHub 開啟 ↗</a>` +
    `<dl class="rows">${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`
  )
}

const detail = pick('detail')

function renderDetail(number: number | undefined): void {
  const issue = number === undefined ? undefined : issueAt(number)
  if (!issue) {
    detail.dataset.status = ''
    detail.innerHTML = '<h3>沒有 issue</h3>'
    return
  }
  detail.dataset.status = issue.status
  detail.innerHTML = detailHTML(issue.number)
}

// ---- 選取 ----

let selected: number | null = null

/** 一張票的整條上下游，用來在選取時把鏈亮起來。 */
function chainOf(start: number): Set<number> {
  const out = new Set([start])
  const walks: ((n: number) => readonly number[])[] = [
    (n) => issueAt(n)?.blockedBy ?? [],
    (n) => unlocks.get(n) ?? [],
  ]
  for (const neighboursOf of walks) {
    const stack = [start]
    while (stack.length) {
      const at = stack.pop()
      if (at === undefined) break
      for (const next of neighboursOf(at)) {
        if (out.has(next)) continue
        out.add(next)
        stack.push(next)
      }
    }
  }
  return out
}

function defaultPick(): number | undefined {
  const first = work.filter((i) => i.status === 'ready').sort(byStatusThenNumber)[0]
  return (first ?? issues[0])?.number
}

/**
 * 選一張票。再點同一張不會取消——在清單上你往往只是想再看一次，取消掉反而要重新找。要清掉
 * 按 Esc。
 */
function select(number: number): void {
  selected = number
  paintSelection()
}

function clearSelection(): void {
  selected = null
  closeExpander()
  paintSelection()
}

function paintSelection(): void {
  const lit = selected === null ? null : chainOf(selected)
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg')) {
    svg.classList.toggle('has-selection', selected !== null)
    for (const node of svg.querySelectorAll<SVGAElement>('.node')) {
      const number = Number(node.dataset.number)
      node.classList.toggle('lit', lit !== null && lit.has(number))
      node.classList.toggle('selected', number === selected)
    }
    for (const edge of svg.querySelectorAll<SVGPathElement>('.edge')) {
      const from = Number(edge.dataset.from)
      const to = Number(edge.dataset.to)
      edge.classList.toggle('lit', lit !== null && lit.has(from) && lit.has(to))
    }
  }
  for (const row of rowsEl.querySelectorAll<HTMLElement>('.row[data-number]')) {
    row.classList.toggle('selected', Number(row.dataset.number) === selected)
  }
  renderDetail(selected ?? defaultPick())
}

// ---- 清單 ----

type Row = { issue: MapIssue; parent: number | null; hasKids: boolean }

const rowsEl = pick('rows')
let filter: Status | 'all' = 'all'

/** 主票在前、它的子票跟在後面。篩選時主票只要有子票入選就留著當標頭。 */
function rowOrder(): Row[] {
  const pass = new Set(
    issues.filter((i) => filter === 'all' || i.status === filter).map((i) => i.number),
  )
  const kids = new Map<number, MapIssue[]>()
  const roots: MapIssue[] = []
  for (const issue of issues) {
    const parent = issue.parent !== null && byNumber.has(issue.parent) ? issue.parent : null
    if (parent === null) {
      if (pass.has(issue.number)) roots.push(issue)
      continue
    }
    if (!pass.has(issue.number)) continue
    const siblings = kids.get(parent) ?? []
    siblings.push(issue)
    kids.set(parent, siblings)
  }
  // 有子票入選但自己沒入選的主票，仍要出現，否則子票就沒了歸屬。
  for (const parent of kids.keys()) {
    const issue = issueAt(parent)
    if (issue && !roots.includes(issue)) roots.push(issue)
  }

  const rows: Row[] = []
  for (const root of roots.sort(byStatusThenNumber)) {
    const children = (kids.get(root.number) ?? []).sort(byStatusThenNumber)
    rows.push({ issue: root, parent: null, hasKids: children.length > 0 })
    for (const child of children) rows.push({ issue: child, parent: root.number, hasKids: false })
  }
  return rows
}

function rowHTML(row: Row): string {
  const issue = row.issue
  const parent = row.parent === null ? '' : ` data-parent="${row.parent}"`
  const kids = row.hasKids ? ' data-haskids="true"' : ''
  const slot = row.hasKids ? '<span class="fold-slot"></span>' : ''
  const waitsTitle =
    issue.waitingFor.length > BLOCKERS_SHOWN
      ? ` title="${esc(issue.waitingFor.map(hash).join(' '))}"`
      : ''
  const waits = issue.waitingFor.length
    ? `<span class="waits"${waitsTitle}>等 ${blockers(issue.waitingFor)}</span>`
    : ''
  return (
    `<div class="row" tabindex="0" data-status="${issue.status}" data-number="${issue.number}"${parent}${kids}>` +
    `<div class="id">${slot}` +
    `<a class="no" href="${esc(issue.url)}" target="_blank" rel="noopener">#${issue.number}</a>` +
    `<span class="who">${issue.author ? esc(issue.author) : '—'}</span></div>` +
    `<div class="what"><span class="title">${esc(issue.title)}</span>${waits}</div>` +
    `<div class="step">${stepCell(issue)}</div>` +
    `<div class="gate">${pill(issue)}</div>` +
    '</div>'
  )
}

function renderRows(): void {
  const rows = rowOrder()
  pick('list-sub').textContent = `${rows.filter((r) => !r.issue.isParent).length} 張`
  rowsEl.innerHTML = rows.map(rowHTML).join('')
  // 主票的收合鈕：innerHTML 重建過，鈕要重新放進去。
  for (const row of rowsEl.querySelectorAll<HTMLElement>('.row[data-haskids="true"]')) {
    row.querySelector('.fold-slot')?.appendChild(foldButton(Number(row.dataset.number)))
  }
}

function renderTabs(): void {
  const tabs = pick('tabs')
  const defs: [Status | 'all', string, number][] = [
    ['all', '全部', work.length],
    ...STATUS_ORDER.map((s) => [s, STATUS_LABEL[s], counts[s]] as [Status, string, number]),
  ]
  for (const [key, label, count] of defs) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'tab'
    tab.dataset.filter = key
    tab.setAttribute('aria-pressed', String(key === filter))
    tab.innerHTML = `${esc(label)}<span class="n">${count}</span>`
    tab.addEventListener('click', () => {
      filter = key
      for (const other of tabs.querySelectorAll<HTMLElement>('.tab')) {
        other.setAttribute('aria-pressed', String(other.dataset.filter === filter))
      }
      renderRows()
      paintSelection()
      const back =
        selected === null
          ? null
          : rowsEl.querySelector<HTMLElement>(`.row[data-number="${selected}"]`)
      if (back && selected !== null) openExpander(back, selected)
    })
    tabs.appendChild(tab)
  }
}

// ---- 就地展開 ----

/**
 * 清單的細節就在被點的那一列底下展開，不把畫面捲到上面的面板——連著看三張票時，視線不用
 * 來回跑。
 */
function closeExpander(): void {
  rowsEl.querySelector('.detail.expand')?.remove()
}

function openExpander(row: HTMLElement, number: number): void {
  closeExpander()
  const issue = issueAt(number)
  if (!issue) return
  const panel = document.createElement('div')
  panel.className = 'detail expand'
  panel.dataset.status = issue.status
  panel.dataset.forNumber = String(number)
  // 掛上 data-parent，主票收起來時 paintFolded 會一起把它藏掉。
  if (row.dataset.parent) panel.dataset.parent = row.dataset.parent
  panel.innerHTML = detailHTML(number)
  row.insertAdjacentElement('afterend', panel)
  paintFolded()
}

function pickRow(row: HTMLElement): void {
  const number = Number(row.dataset.number)
  const already = rowsEl.querySelector(`.detail.expand[data-for-number="${number}"]`)
  // 上面的面板換一張票會改變自己的高度，把清單整段推走。先記下這一列在畫面上的位置，改完
  // 再補回去，手指底下的那一列就不會跑。
  const before = row.getBoundingClientRect().top
  select(number)
  if (already) closeExpander()
  else openExpander(row, number)
  const shift = row.getBoundingClientRect().top - before
  if (shift) window.scrollBy({ top: shift, behavior: 'instant' })
}

// ---- 複製 ----

/**
 * 複製到剪貼簿。`navigator.clipboard` 在非安全來源沒有，而就算有也可能被權限擋掉（沒有使用者
 * 手勢、或瀏覽器設定），所以失敗一律退回選取再 execCommand。
 */
function legacyCopy(text: string): Promise<void> {
  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.style.cssText = 'position:fixed;top:-100px;opacity:0'
  document.body.appendChild(box)
  box.select()
  const ok = document.execCommand('copy')
  box.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error('複製失敗'))
}

function copyText(text: string): Promise<void> {
  if (!navigator.clipboard || !window.isSecureContext) return legacyCopy(text)
  return navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
}

function flash(label: HTMLElement, text: string, ms: number, then: () => void): void {
  label.textContent = text
  setTimeout(then, ms)
}

function handleCopy(button: HTMLElement): void {
  const label = button.querySelector<HTMLElement>('.copy-text')
  const command = button.dataset.copy
  if (!label || !command) return
  const was = label.textContent ?? ''
  copyText(command).then(
    () => {
      button.dataset.copied = 'true'
      flash(label, '已複製', 1200, () => {
        delete button.dataset.copied
        label.textContent = was
      })
    },
    () => flash(label, '複製不了', 1600, () => (label.textContent = was)),
  )
}

// ---- 事件 ----

function elementAt(ev: Event): Element | null {
  return ev.target instanceof Element ? ev.target : null
}

// 一個委派聽事件，換分頁不用重掛。
rowsEl.addEventListener('click', (ev) => {
  const target = elementAt(ev)
  if (!target) return
  const copy = target.closest<HTMLElement>('.copy')
  if (copy) {
    // 複製是自己一件事，不要順手把那一列也選起來。
    ev.stopPropagation()
    handleCopy(copy)
    return
  }
  if (target.closest('a') || target.closest('.fold')) return
  const row = target.closest<HTMLElement>('.row[data-number]')
  if (row) pickRow(row)
})

rowsEl.addEventListener('keydown', (ev) => {
  const target = elementAt(ev)
  const row = target?.closest<HTMLElement>('.row[data-number]')
  if (!row) return
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault()
    pickRow(row)
    return
  }
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
  ev.preventDefault()
  const rows = [...rowsEl.querySelectorAll<HTMLElement>('.row[data-number]:not([hidden])')]
  const next = rows[rows.indexOf(row) + (ev.key === 'ArrowDown' ? 1 : -1)]
  next?.focus()
})

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') clearSelection()
})

// ---- 起動 ----

renderHeader()
renderGroups()
renderTabs()
renderRows()
onFold.push(paintFolded)
paintFolded()
renderDetail(defaultPick())
