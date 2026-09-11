/**
 * 把快照畫成 HTML 字串。**沒有 Bun、沒有 DOM**——建置那一側（`issue-map.ts`）拿它把頁面預先
 * 畫好寫進檔案，畫面那一側（`issue-map-page.ts`）拿同一批函式在換語言／換篩選時重畫。
 *
 * 一份標記只有一個產生處：兩邊畫出來的東西必然一致，不會有「靜態看到一種、互動後變另一種」。
 * 也因此這一支不能碰 `document`——互動（點擊、收合、選取）全部留在畫面那一側用事件代理處理。
 *
 * 文案一律走 `issue-map-i18n.ts` 的 `t()`，它讀的是當下語言。
 */

import { locale, t } from './issue-map-i18n.ts'
import {
  type Edge,
  type Group,
  layoutOf,
  type Layout,
  MAP,
  type MapIssue,
  type NextStep,
  type Point,
  type Snapshot,
  STATUS_ORDER,
  type Status,
} from './issue-map-model.ts'

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c)
}

/**
 * 站名就是標題開頭。刻意不另設一個「短名」欄位——那要每張票靠人維護，而且會變成票名的第二個
 * 來源，改了標題不會跟著改。截到讀不通的時候，滑鼠停留與下面的清單都有完整標題。
 */
const HEAD_CHARS = 7

/** 等誰那一欄只列前幾張，完整清單放 title——一張主票可以等十幾張子票。 */
const BLOCKERS_SHOWN = 4

const TRACK_COLOURS = ['--t1', '--t2', '--t3', '--t4']

/**
 * 最多畫幾張圖。
 *
 * 一組沒有阻擋關係的票畫出來只是一片點陣，而 `grafana/grafana` 那種規模是 108 組裡 103 組都
 * 這樣——那 103 張點陣沒有人會讀，卻佔掉產出的 2MB。有線路的一定畫，其餘補到這個數為止，剩下
 * 的只留標頭。票照樣在下面的清單裡，一張都不會少。
 */
const MAX_MAPS = 20

/** 一群票對應的一張圖。`members` 是票，`track` 是這一組的線色。 */
export type Shown = { group: Group; members: readonly MapIssue[]; track: string }

export type Row = { issue: MapIssue; parent: number | null; hasKids: boolean }

export type Filter = Status | 'all'

/**
 * 一份快照畫得出來的所有東西。
 *
 * 先算一次衍生資料（計數、反向索引），再把畫的函式掛上去——兩側都只要 `viewOf(snapshot)` 一次
 * 就能重複畫。
 */
export function viewOf(snapshot: Partial<Snapshot>) {
  const issues: readonly MapIssue[] = snapshot.issues ?? []
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]))
  const work = issues.filter((issue) => !issue.isParent)
  const criticalPath = snapshot.criticalPath ?? 0
  const repo = snapshot.repo ?? ''

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

  const issueAt = (number: number): MapIssue | undefined => byNumber.get(number)

  const byStatusThenNumber = (a: MapIssue, b: MapIssue): number =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.number - b.number

  const statusLabel = (status: Status): string => t(`status.${status}`)

  /** 日期一律照當下語言排。快照裡存的是 ISO 字串，格式化是畫面的事。 */
  const dateTime = (iso: string): string =>
    new Date(iso).toLocaleString(locale(), { hour12: false })
  const dateOnly = (iso: string): string => new Date(iso).toLocaleDateString(locale())

  const head = (title: string): string =>
    title.length > HEAD_CHARS ? `${title.slice(0, HEAD_CHARS)}…` : title

  const hash = (n: number): string => `#${n}`

  const link = (n: number): string => {
    const issue = issueAt(n)
    return issue ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">#${n}</a>` : `#${n}`
  }

  const pill = (issue: MapIssue): string =>
    `<span class="pill" data-status="${issue.status}">${esc(statusLabel(issue.status))}</span>`

  const blockers = (list: readonly number[]): string => {
    if (!list.length) return '—'
    if (list.length <= BLOCKERS_SHOWN) return list.map(hash).join(' ')
    const rest = list.length - BLOCKERS_SHOWN
    return `${list.slice(0, BLOCKERS_SHOWN).map(hash).join(' ')} <span class="more">+${rest}</span>`
  }

  /** 下一步的句子。模型只說是哪一種，話在這裡才組出來。 */
  const stepText = (step: NextStep): string => {
    switch (step.kind) {
      case 'none':
        return '—'
      case 'command':
        return step.command
      case 'manual':
        return t('step.manual')
      case 'active':
        return step.who.length ? step.who.join(t('join.slash')) : t('step.active')
      case 'waitIssues':
        return t('step.waitIssues', { issues: step.issues.map(hash).join(' ') })
      case 'waitChildren':
        return t('step.waitChildren', { n: step.count })
      case 'parentReady':
        return t('step.parentReady')
    }
  }

  /**
   * 是指令的時候做成按鈕，按了把「指令 ＋ 票號」整句複製走——真正要貼進去的是那一整句，只顯示
   * 指令的話還得自己補票號。其他的（接手的人、等哪幾張）就純文字。
   */
  const stepCell = (issue: MapIssue): string => {
    const step = issue.nextStep
    if (step.kind !== 'command') return `<span class="next">${esc(stepText(step))}</span>`
    const command = `${step.command} #${issue.number}`
    const title = esc(t('copy.title', { command }))
    return (
      `<button type="button" class="copy" data-copy="${esc(command)}" title="${title}">` +
      `<span class="copy-text">${esc(step.command)}</span></button>`
    )
  }

  // ---- 抬頭 ----

  const title = (): string => {
    const name = repo.split('/').pop()
    return name ? t('title.withRepo', { repo: name }) : t('title.plain')
  }

  const eyebrow = (): string =>
    repo + (snapshot.generatedAt ? ` · ${dateTime(snapshot.generatedAt)}` : '')

  /** 導言只講數得出來的事實。沒有可動的票、或整批都關完了，句子跟著換。 */
  const lede = (): string => {
    if (!openCount) return t('lede.allDone')
    const frontline = work.filter((i) => i.status === 'ready').sort(byStatusThenNumber)
    const parts = [t('lede.open', { n: openCount })]
    if (frontline.length) {
      const first = frontline
        .slice(0, 3)
        .map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener">#${i.number}</a>`)
        .join(t('join.items'))
      parts.push(t('lede.ready', { n: frontline.length, issues: first }))
    } else {
      parts.push(t('lede.none'))
    }
    if (counts.blocked) parts.push(t('lede.blocked', { n: counts.blocked }))
    if (counts.triage) parts.push(t('lede.triage', { n: counts.triage }))
    if (criticalPath > 1) parts.push(t('lede.critical', { n: criticalPath }))
    return parts.join(' ')
  }

  const statsHTML = (): string => {
    const tiles: { label: string; value: number; unit?: string; tone?: string }[] = [
      { label: t('stat.ready'), value: counts.ready, tone: 'ready' },
      { label: t('stat.active'), value: counts.active, tone: 'active' },
      { label: t('stat.blocked'), value: counts.blocked, unit: `/ ${openCount}`, tone: 'blocked' },
      { label: t('stat.triage'), value: counts.triage, tone: 'triage' },
      {
        label: t('stat.critical'),
        value: criticalPath,
        unit: t('stat.critical.unit', { n: criticalPath }),
      },
    ]
    return tiles
      .map((tile) => {
        const tone = tile.tone ? ` data-tone="${tile.tone}"` : ''
        const unit = tile.unit ? `<small>${esc(tile.unit)}</small>` : ''
        return `<div class="stat"${tone}><b>${tile.value}${unit}</b><span>${esc(tile.label)}</span></div>`
      })
      .join('')
  }

  const footerHTML = (): { truth: string; refresh: string; config: string } => {
    const code = (command: string) => `<code>${esc(command)}</code>`
    const vocab = snapshot.labels ?? { ready: [], unready: [] }
    return {
      truth: esc(t('foot.truth')),
      refresh: t('foot.refresh', {
        build: code('bun run issue-map'),
        serve: code('bun run issue-map:serve'),
      }),
      // 標籤名是 repo 給的字，逃脫過才進 innerHTML。
      config: esc(
        vocab.ready.length
          ? t('foot.vocab', {
              ready: vocab.ready.join(t('join.or')),
              unready: vocab.unready.join(t('join.slash')),
            })
          : t('foot.noVocab'),
      ),
    }
  }

  // ---- 線路圖 ----

  /**
   * 同一條線就是一橫。跨線走「向右、轉、向下、轉、向右」，而垂直那一段刻意走在站與站之間的
   * 間隙裡——走中點的話會壓到中間那幾條線的站名。同一個終點有多條邊時各自錯開一點，不然它們
   * 會完全重疊成一條。
   */
  const railPath = (a: Point, b: Point, nudge: number): string => {
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

  const svgTag = (tag: string, attrs: Readonly<Record<string, string | number>>): string => {
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
  const stationShape = (status: Status, q: Point): string => {
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

  const railHTML = (edge: Edge, layout: Layout, nudge: number): string => {
    const a = layout.xy.get(edge.from)
    const b = layout.xy.get(edge.to)
    if (!a || !b) return ''
    const done = issueAt(edge.from)?.status === 'done'
    return svgTag('path', {
      class: 'edge',
      d: railPath(a, b, nudge),
      'data-from': edge.from,
      'data-to': edge.to,
      'data-done': String(done),
    })
  }

  const stationHTML = (issue: MapIssue, q: Point): string => {
    const aria = esc(
      t('node.aria', { n: issue.number, title: issue.title, status: statusLabel(issue.status) }),
    )
    return (
      `<a class="node" href="${esc(issue.url)}" target="_blank" rel="noopener"` +
      ` aria-label="${aria}" data-status="${issue.status}" data-number="${issue.number}">` +
      stationShape(issue.status, q) +
      `<text class="sid" x="${q.x}" y="${q.y - 15}" text-anchor="middle">#${issue.number}</text>` +
      `<text class="sdesc" x="${q.x}" y="${q.y + 24}" text-anchor="middle">${esc(head(issue.title))}</text>` +
      `<title>#${issue.number} ${esc(issue.title)}</title>` +
      '</a>'
    )
  }

  /**
   * 線名畫在 SVG 外面的一個 HTML 欄位裡，不是 SVG 的 `<text>`。
   *
   * SVG 的文字不會換行也不會自己截斷，長一點的線名（「互不阻擋，可各自開工」那種，而且每種語言
   * 長度不同）會直接蓋到第一個站點上。放進 HTML 之後 `text-overflow` 就管得到，而且不需要任何
   * JS 量寬度——沒有 JS 的環境也不會疊在一起。
   */
  const trackLabelsHTML = (layout: Layout): string => {
    const labels: string[] = []
    layout.tracks.forEach((chain, index) => {
      const terminus = chain[chain.length - 1]
      // 單站線沒有「這條線在做什麼」可講，不標。
      if (chain.length < 2 || terminus === undefined) return
      labels.push(
        `<div class="tlabel" style="top:${MAP.top + index * MAP.row}px">` +
          `<b>→ #${terminus}</b><span>${esc(t('map.stations', { n: chain.length }))}</span></div>`,
      )
    })
    if (layout.islandRows) {
      labels.push(
        `<div class="tlabel" style="top:${MAP.top + layout.islandFrom * MAP.row}px">` +
          `<b>${esc(t('map.islandName'))}</b><span>${esc(t('map.islandSub'))}</span></div>`,
      )
    }
    return labels.join('')
  }

  const mapHTML = (shown: Shown): string => {
    const layout = layoutOf(shown.members)
    const seenTo = new Map<number, number>()
    const rails = layout.edges
      .map((edge) => {
        const nth = seenTo.get(edge.to) ?? 0
        seenTo.set(edge.to, nth + 1)
        return railHTML(edge, layout, nth)
      })
      .join('')
    const stations = shown.members
      .map((member) => {
        const q = layout.xy.get(member.number)
        return q ? stationHTML(member, q) : ''
      })
      .join('')
    return (
      `<div class="map-wrap" style="--track:${shown.track}">` +
      trackLabelsHTML(layout) +
      `<svg width="${layout.width}" height="${layout.height}"` +
      ` viewBox="0 0 ${layout.width} ${layout.height}" role="img">` +
      rails +
      stations +
      '</svg></div>'
    )
  }

  /** 每張圖底下重複一份 key。圖可以收起來，key 跟著收，不會留一段沒有圖的說明。 */
  const mapKeyHTML = (): string => {
    const shapes: readonly [string, string][] = [
      ['k-ready', t('legend.ready')],
      ['k-active', t('legend.active')],
      ['k-blocked', t('legend.blocked')],
      ['k-triage', t('legend.triage')],
      ['k-done', t('legend.done')],
    ]
    return (
      '<div class="map-key">' +
      shapes.map(([mark, label]) => `<span><i class="${mark}"></i>${esc(label)}</span>`).join('') +
      `<span>${esc(t('legend.solid'))}</span>` +
      `<span>${esc(t('legend.dashed'))}</span>` +
      '</div>'
    )
  }

  /** 一群票的標題。主票那一群用主票標題（真資料），其他三種是頁面自己的分類。 */
  const groupTitle = (group: Group): string => {
    switch (group.name.kind) {
      case 'spec':
        return group.name.title
      case 'orphan':
        return t('group.orphan', { n: group.name.parent })
      case 'linked':
        return t('group.linked')
      case 'island':
        return t('group.island')
    }
  }

  const groupSub = (shown: Shown): string => {
    const parent = shown.group.parent
    // 「其他依賴鏈」與「獨立票」都沒有主票，但只有後者互不阻擋——同一句話蓋兩種群會說謊。
    if (shown.group.name.kind === 'linked') return esc(t('group.linkedSub'))
    if (parent === null) return esc(t('group.islandSub'))
    const done = shown.members.filter((m) => m.status === 'done').length
    const spec = issueAt(parent)
    const specLink = spec
      ? `<a href="${esc(spec.url)}" target="_blank" rel="noopener">${esc(
          t('group.spec', { n: parent }),
        )}</a> · `
      : ''
    return specLink + esc(t('group.progress', { done, total: shown.members.length }))
  }

  const foldButtonHTML = (parent: number): string =>
    `<button type="button" class="fold" data-fold-for="${parent}" aria-expanded="true"></button>`

  const shownGroups = (): Shown[] =>
    (snapshot.groups ?? []).map((group, index) => ({
      group,
      members: group.members.map(issueAt).filter((issue): issue is MapIssue => issue !== undefined),
      track: `var(${TRACK_COLOURS[index % TRACK_COLOURS.length]})`,
    }))

  /** 這一組裡有沒有票互相擋著。沒有的話畫出來只是一片點陣，不是線路圖。 */
  const hasRails = (shown: Shown): boolean => {
    const inGroup = new Set(shown.members.map((m) => m.number))
    return shown.members.some((m) => m.blockedBy.some((n) => inGroup.has(n)))
  }

  const groupsHTML = (): string => {
    const groups = shownGroups()
    // 有線路的一定畫；其餘照原順序補到上限。剩下的只留標頭，票照樣在下面的清單裡。
    const drawn = new Set(groups.filter(hasRails))
    for (const shown of groups) {
      if (drawn.size >= MAX_MAPS) break
      drawn.add(shown)
    }
    return groups
      .map((shown) => {
        const parent = shown.group.parent
        const fold = parent === null ? '' : foldButtonHTML(parent)
        const attrs = parent === null ? '' : ` data-fold="${parent}"`
        const bodyAttrs = parent === null ? '' : ` data-parent="${parent}"`
        const body = drawn.has(shown)
          ? mapHTML(shown).replace('class="map-wrap"', `class="map-wrap"${bodyAttrs}`) +
            mapKeyHTML()
          : `<p class="undrawn"${bodyAttrs}>${esc(t('group.undrawn'))}</p>`
        return (
          `<section class="group" style="--track:${shown.track}"${attrs}>` +
          `<div class="group-head">${fold}<h2>${esc(groupTitle(shown.group))}</h2>` +
          `<span class="sub">${groupSub(shown)}</span></div>` +
          body +
          '</section>'
        )
      })
      .join('')
  }

  // ---- 詳細 ----

  /** 一張票的細節。上面的面板與清單裡展開的那一列共用同一份標記。 */
  const detailHTML = (number: number): string => {
    const issue = issueAt(number)
    if (!issue) return ''
    const settled = issue.blockedBy.filter((b) => !issue.waitingFor.includes(b))
    const opens = (unlocks.get(number) ?? []).filter((n) => issueAt(n)?.status !== 'done')
    const closed = issue.closedAt
      ? esc(t('detail.closedAt', { date: dateOnly(issue.closedAt) }))
      : ''
    const rows: [string, string][] = [
      [t('detail.status'), pill(issue) + closed],
      [t('detail.next'), stepCell(issue)],
    ]
    if (issue.author) rows.push([t('detail.author'), esc(issue.author)])
    if (issue.parent !== null) rows.push([t('detail.parent'), link(issue.parent)])
    if (issue.waitingFor.length) {
      rows.push([t('detail.waiting'), issue.waitingFor.map(link).join(' ')])
    }
    if (settled.length) rows.push([t('detail.settled'), settled.map(link).join(' ')])
    if (opens.length) rows.push([t('detail.unlocks'), opens.map(link).join(' ')])
    if (issue.labels.length) {
      rows.push([
        t('detail.labels'),
        issue.labels.map((l) => `<span class="label">${esc(l)}</span>`).join(''),
      ])
    }
    if (issue.assignees.length) {
      rows.push([t('detail.assignees'), esc(issue.assignees.join(', '))])
    }
    return (
      `<h3><span class="num">#${issue.number}</span>${esc(issue.title)}</h3>` +
      `<a class="open" href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(
        t('detail.open'),
      )}</a>` +
      `<dl class="rows">${rows.map(([dt, dd]) => `<dt>${esc(dt)}</dt><dd>${dd}</dd>`).join('')}</dl>`
    )
  }

  /** 沒有選取時預設看哪一張：第一張可接手的，再不然就第一張。 */
  const defaultPick = (): number | undefined => {
    const first = work.filter((i) => i.status === 'ready').sort(byStatusThenNumber)[0]
    return (first ?? issues[0])?.number
  }

  const detailPanelHTML = (number: number | undefined): { status: string; html: string } => {
    const issue = number === undefined ? undefined : issueAt(number)
    if (!issue) return { status: '', html: `<h3>${esc(t('detail.empty'))}</h3>` }
    return { status: issue.status, html: detailHTML(issue.number) }
  }

  // ---- 清單 ----

  /** 主票在前、它的子票跟在後面。篩選時主票只要有子票入選就留著當標頭。 */
  const rowOrder = (filter: Filter): Row[] => {
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

  const rowHTML = (row: Row): string => {
    const issue = row.issue
    const parent = row.parent === null ? '' : ` data-parent="${row.parent}"`
    const kids = row.hasKids ? ' data-haskids="true"' : ''
    const slot = row.hasKids ? `<span class="fold-slot">${foldButtonHTML(issue.number)}</span>` : ''
    const waitsTitle =
      issue.waitingFor.length > BLOCKERS_SHOWN
        ? ` title="${esc(issue.waitingFor.map(hash).join(' '))}"`
        : ''
    const waits = issue.waitingFor.length
      ? `<span class="waits"${waitsTitle}>${t('row.waits', {
          list: blockers(issue.waitingFor),
        })}</span>`
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

  const rowsHTML = (filter: Filter): { html: string; shown: number } => {
    const rows = rowOrder(filter)
    return {
      html: rows.map(rowHTML).join(''),
      shown: rows.filter((r) => !r.issue.isParent).length,
    }
  }

  const tabsHTML = (filter: Filter): string => {
    const defs: [Filter, string, number][] = [
      ['all', t('tabs.all'), work.length],
      ...STATUS_ORDER.map((s) => [s, statusLabel(s), counts[s]] as [Status, string, number]),
    ]
    return defs
      .map(
        ([key, label, count]) =>
          `<button type="button" class="tab" data-filter="${key}"` +
          ` aria-pressed="${key === filter}">${esc(label)}<span class="n">${count}</span></button>`,
      )
      .join('')
  }

  /** 一張票的整條上下游，用來在選取時把鏈亮起來。 */
  const chainOf = (start: number): Set<number> => {
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

  return {
    issues,
    issueAt,
    chainOf,
    defaultPick,
    title,
    eyebrow,
    lede,
    statsHTML,
    footerHTML,
    groupsHTML,
    detailHTML,
    detailPanelHTML,
    rowsHTML,
    tabsHTML,
  }
}

export type View = ReturnType<typeof viewOf>
