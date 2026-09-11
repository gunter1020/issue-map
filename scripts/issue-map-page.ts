/**
 * 開發地圖的畫面。`issue-map.ts` 用 `Bun.build` 把這支打包成一段 script 塞進樣板，所以它
 * **只能碰瀏覽器的東西**，不能 import Bun 的 API。
 *
 * 標記全部在 `issue-map-view.ts`，而且建置時就已經用同一批函式畫過一次寫進檔案了——這一支只在
 * 換語言、換篩選、選取、收合時重畫。所以沒有 JS 的環境看到的是同一份頁面，只是不能互動。
 *
 * 這裡剩下的是 DOM 與事件：讀寫 localStorage 的兩個偏好（語言、收合）、事件代理、選取狀態。
 */

import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  LOCALE_NAME,
  LOCALES,
  locale,
  setLocale,
  t,
} from './issue-map-i18n.ts'
import { type Snapshot } from './issue-map-model.ts'
import { esc, type Filter, viewOf } from './issue-map-view.ts'

/** 樣板保證這些節點存在。找不到就是樣板被改壞了，早點喊比畫出半張圖好。 */
function pick(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`樣板缺少 #${id}`)
  return node
}

const snapshot = JSON.parse(pick('issue-map-data').textContent || '{}') as Partial<Snapshot>
const view = viewOf(snapshot)
const repo = snapshot.repo ?? ''

const detail = pick('detail')
const rowsEl = pick('rows')
const groupsEl = pick('groups')
const tabsEl = pick('tabs')

let selected: number | null = null
let filter: Filter = 'all'

// ---- 語言 ----

/**
 * 語言記在瀏覽器、而且不分 repo——同一個人看好幾個 repo 的地圖，語言是他的偏好，不是某個專案
 * 的設定。讀不到（無痕、封鎖）或存的是舊值就用預設的英文。
 *
 * 刻意不看 `navigator.language`：這一頁的預設語言是英文，猜錯了反而要每次進來都改回去。
 */
const LOCALE_KEY = 'issue-map:locale'

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // 讀不到就用預設，畫面照樣是完整的。
  }
  return DEFAULT_LOCALE
}

/** 語言選單只做一次；換語言是整頁重畫，選單自己不重建，不然焦點會掉。 */
function mountLangPicker(): void {
  const picker = pick('lang')
  if (!(picker instanceof HTMLSelectElement)) throw new Error('#lang 不是 select')
  picker.innerHTML = LOCALES.map(
    (option) => `<option value="${option}">${esc(LOCALE_NAME[option])}</option>`,
  ).join('')
  picker.value = locale()
  picker.addEventListener('change', () => {
    if (!isLocale(picker.value)) return
    setLocale(picker.value)
    try {
      localStorage.setItem(LOCALE_KEY, picker.value)
    } catch {
      // 存不了就只在這一次有效。
    }
    render()
  })
}

// ---- 收合狀態 ----

/**
 * 收合狀態只有一份，地圖與清單都讀它、都能改它。每個瀏覽器記自己的；讀不到（無痕、封鎖）
 * 就當成全部展開。
 */
const COLLAPSE_KEY = `issue-map:collapsed:${repo}`

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
  paintFolded()
}

/**
 * 收合只在這裡畫一次：列、就地展開的細節、地圖本體，凡是掛了 data-parent 的都聽它。收合鈕的
 * 樣子也在這裡補上——建置時畫出來的鈕是空的，因為那時還不知道這個瀏覽器記了什麼。
 */
function paintFolded(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-parent]')) {
    node.hidden = isFolded(Number(node.dataset.parent))
  }
  for (const section of document.querySelectorAll<HTMLElement>('section.group[data-fold]')) {
    section.dataset.folded = String(isFolded(Number(section.dataset.fold)))
  }
  for (const button of document.querySelectorAll<HTMLElement>('.fold[data-fold-for]')) {
    const parent = Number(button.dataset.foldFor)
    const open = !isFolded(parent)
    button.setAttribute('aria-expanded', String(open))
    button.setAttribute(
      'aria-label',
      open ? t('fold.collapse', { n: parent }) : t('fold.expand', { n: parent }),
    )
    button.textContent = open ? '−' : '+'
  }
}

// ---- 選取 ----

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
  const lit = selected === null ? null : view.chainOf(selected)
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg')) {
    svg.classList.toggle('has-selection', selected !== null)
    for (const node of svg.querySelectorAll<SVGElement>('.node')) {
      const number = Number(node.dataset.number)
      node.classList.toggle('lit', lit !== null && lit.has(number))
      node.classList.toggle('selected', number === selected)
    }
    for (const edge of svg.querySelectorAll<SVGElement>('.edge')) {
      const from = Number(edge.dataset.from)
      const to = Number(edge.dataset.to)
      edge.classList.toggle('lit', lit !== null && lit.has(from) && lit.has(to))
    }
  }
  for (const row of rowsEl.querySelectorAll<HTMLElement>('.row[data-number]')) {
    row.classList.toggle('selected', Number(row.dataset.number) === selected)
  }
  renderDetail(selected ?? view.defaultPick())
}

function renderDetail(number: number | undefined): void {
  const panel = view.detailPanelHTML(number)
  detail.dataset.status = panel.status
  detail.innerHTML = panel.html
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
  const issue = view.issueAt(number)
  if (!issue) return
  const panel = document.createElement('div')
  panel.className = 'detail expand'
  panel.dataset.status = issue.status
  panel.dataset.forNumber = String(number)
  // 掛上 data-parent，主票收起來時 paintFolded 會一起把它藏掉。
  if (row.dataset.parent) panel.dataset.parent = row.dataset.parent
  panel.innerHTML = view.detailHTML(number)
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
  return ok ? Promise.resolve() : Promise.reject(new Error('execCommand copy failed'))
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
      flash(label, t('copy.done'), 1200, () => {
        delete button.dataset.copied
        label.textContent = was
      })
    },
    () => flash(label, t('copy.fail'), 1600, () => (label.textContent = was)),
  )
}

// ---- 事件 ----

function elementAt(ev: Event): Element | null {
  return ev.target instanceof Element ? ev.target : null
}

// 全部走委派：標記是建置時畫好的，重畫也只是換 innerHTML，沒有可以逐一掛監聽的時機。
document.addEventListener('click', (ev) => {
  const target = elementAt(ev)
  if (!target) return

  const fold = target.closest<HTMLElement>('.fold[data-fold-for]')
  if (fold) {
    const parent = Number(fold.dataset.foldFor)
    setFolded(parent, !isFolded(parent))
    return
  }

  const copy = target.closest<HTMLElement>('.copy')
  if (copy) {
    // 複製是自己一件事，不要順手把那一列也選起來。
    ev.stopPropagation()
    handleCopy(copy)
    return
  }

  const tab = target.closest<HTMLElement>('.tab[data-filter]')
  if (tab) {
    filter = (tab.dataset.filter ?? 'all') as Filter
    renderRows()
    paintSelection()
    const back =
      selected === null
        ? null
        : rowsEl.querySelector<HTMLElement>(`.row[data-number="${selected}"]`)
    if (back && selected !== null) openExpander(back, selected)
    return
  }

  // 點站看詳細；要開 GitHub 用 ⌘／Ctrl 點，或詳細面板裡的連結。
  const node = target.closest<HTMLElement>('.node[data-number]')
  if (node) {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return
    ev.preventDefault()
    const number = Number(node.dataset.number)
    // 再點同一站就取消，跟點空白處一樣——不然亮起來之後只剩 Esc 能收，那沒人找得到。
    if (selected === number) clearSelection()
    else select(number)
    return
  }

  // 點圖上的空白處就取消亮線。
  if (target.closest('.map-wrap')) {
    clearSelection()
    return
  }

  if (target.closest('a')) return
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

// ---- 重畫 ----

function renderRows(): void {
  const rows = view.rowsHTML(filter)
  pick('list-title').textContent = t('list.title')
  pick('list-sub').textContent = t('list.count', { n: rows.shown })
  rowsEl.innerHTML = rows.html
  tabsEl.innerHTML = view.tabsHTML(filter)
  paintFolded()
}

/**
 * 整頁重畫。換語言就是走這裡——每一段都會先清掉自己那一塊，所以重畫一次不會留下上一種語言的
 * 殘骸。選取與收合是狀態不是文字，重畫時保留。
 */
function render(): void {
  const heading = view.title()
  pick('page-title').textContent = heading
  document.title = heading
  document.documentElement.lang = locale()
  pick('lang').setAttribute('aria-label', t('lang.label'))
  pick('eyebrow').textContent = view.eyebrow()
  pick('lede').innerHTML = view.lede()
  pick('stats').innerHTML = view.statsHTML()

  const foot = view.footerHTML()
  pick('foot-truth').textContent = foot.truth
  pick('foot-refresh').innerHTML = foot.refresh
  pick('foot-config').textContent = foot.config

  groupsEl.innerHTML = view.groupsHTML()
  tabsEl.setAttribute('aria-label', t('tabs.aria'))
  renderRows()
  // paintSelection 收尾會畫詳細，沒有選取時它自己退回預設那一張。
  paintSelection()
}

setLocale(readLocale())
mountLangPicker()
render()
