/**
 * 頁面文案。**沒有 Bun、沒有 DOM**——它只是字典與一個查表函式，所以抓資料那一側與畫面那一側
 * 都能 import。
 *
 * 這裡是頁面上所有給人看的字的唯一來源。畫面那一側不寫死任何一句話，模型那一側送的是結構化
 * 的值（`nextStep`、分組名字），句子在這裡才組出來——否則同一句話會同時長在模型、樣板與畫面
 * 三處，換語言只會換到其中一處。
 *
 * `en` 是原稿，也是鍵的定義處：`Messages` 由它推導，少翻一個鍵就編不過。翻譯缺鍵不 fallback
 * 成英文——那會安靜地留下半英半中的畫面。
 *
 * 字典的值會進 `innerHTML`（`lede.*` 刻意帶 `<strong>`），所以**翻譯裡不要放意料外的標記**；
 * 代入的值由呼叫端負責逃脫。
 */

/** 支援的語言。第一個是預設。 */
export const LOCALES = ['en', 'zh-TW', 'zh-CN', 'ja'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** 語言選單上的字。一律寫該語言自己的說法，不翻譯。 */
export const LOCALE_NAME: Readonly<Record<Locale, string>> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  ja: '日本語',
}

/** 要分單複數的句子。英文才用得到，中日文寫成單一句字串就好。 */
type Plural = { readonly one: string; readonly other: string }

type Message = string | Plural

// ---- 原稿 ----

const EN = {
  'lang.label': 'Language',

  'title.withRepo': '{repo} dev map',
  'title.plain': 'Dev map',

  'stat.ready': 'ready now',
  'stat.active': 'picked up',
  'stat.blocked': 'blocked',
  'stat.triage': 'not settled',
  'stat.critical': 'critical path',
  'stat.critical.unit': { one: 'issue', other: 'issues' },

  'lede.allDone': 'Nothing open in this repo.',
  'lede.open': { one: '{n} issue open.', other: '{n} issues open.' },
  'lede.ready': {
    one: '<strong>{n} ready now — {issues}</strong>.',
    other: '<strong>{n} ready now, starting with {issues}</strong>.',
  },
  'lede.none':
    '<strong>Nothing is ready right now</strong> — every issue waits on a prerequisite or on triage.',
  'lede.blocked': {
    one: '{n} issue blocked by a prerequisite.',
    other: '{n} issues blocked by prerequisites.',
  },
  'lede.triage': {
    one: '{n} issue still needs triage.',
    other: '{n} issues still need triage.',
  },
  'lede.critical': 'Critical path {n} — that is the fewest rounds this can close in.',

  'foot.truth':
    'GitHub Issues is the source of truth. This page is a snapshot; you cannot change status here.',
  'foot.refresh': 'Re-run {build} for a file, or {serve} so a refresh is always current.',
  'foot.vocab':
    "This run's gate: {ready} means ready to work on; {unready} or no role label means not settled.",
  'foot.noVocab':
    'This repo does not use triage labels, so status only reflects prerequisites and hand-offs.',
  /** 兩種串接：`or` 是「A 或 B」，`slash` 串一票標籤名，`items` 串一串票號。 */
  'join.or': ' or ',
  'join.slash': ', ',
  'join.items': ', ',

  'fold.collapse': 'Collapse sub-issues of #{n}',
  'fold.expand': 'Expand sub-issues of #{n}',

  'map.stations': { one: '{n} stop', other: '{n} stops' },
  'map.islandName': 'no prerequisites',
  'map.islandSub': 'can start in parallel',
  'legend.ready': 'ready now',
  'legend.active': 'picked up',
  'legend.blocked': 'waiting on prerequisite',
  'legend.triage': 'not settled',
  'legend.done': 'closed',
  'legend.solid': 'solid = prerequisite still open',
  'legend.dashed': 'dashed = prerequisite closed',
  'node.aria': '#{n} {title}, {status}',

  'group.linked': 'other dependency chains',
  'group.island': 'independent issues',
  'group.orphan': 'sub-issues of #{n}',
  'group.islandSub': 'nothing blocks anything, all can start in parallel',
  'group.linkedSub': 'linked by prerequisites, but under no parent issue',
  'group.spec': '#{n} parent spec',
  'group.progress': 'sub-issues {done} / {total} done · parent closes only when all do',
  'group.undrawn':
    'Map not drawn — nothing here blocks anything. The issues are in the list below.',

  'status.ready': 'ready',
  'status.active': 'in progress',
  'status.blocked': 'blocked',
  'status.triage': 'needs triage',
  'status.done': 'done',

  'step.active': 'in progress',
  'step.manual': 'human work',
  'step.waitIssues': 'waiting on {issues}',
  'step.waitChildren': {
    one: 'waiting on {n} sub-issue',
    other: 'waiting on {n} sub-issues',
  },
  'step.parentReady': 'all sub-issues closed, safe to close',

  'detail.status': 'status',
  'detail.next': 'next step',
  'detail.author': 'opened by',
  'detail.parent': 'parent',
  'detail.waiting': 'waiting on',
  'detail.settled': 'cleared prerequisites',
  'detail.unlocks': 'closing unlocks',
  'detail.labels': 'labels',
  'detail.assignees': 'assigned',
  'detail.closedAt': ' closed {date}',
  'detail.open': 'Open on GitHub ↗',
  'detail.empty': 'No issue',

  'row.waits': 'waiting on {list}',

  'list.title': 'List',
  'list.count': { one: '{n} issue', other: '{n} issues' },
  'tabs.aria': 'Filter by status',
  'tabs.all': 'all',

  'copy.title': 'Copy {command}',
  'copy.done': 'copied',
  'copy.fail': 'copy failed',
} as const satisfies Readonly<Record<string, Message>>

export type MessageKey = keyof typeof EN

/** 翻譯要把鍵補齊；單複數那幾句可以只寫一句。 */
type Messages = Readonly<Record<MessageKey, Message>>

// ---- 翻譯 ----

const ZH_TW: Messages = {
  'lang.label': '語言',

  'title.withRepo': '{repo} 開發地圖',
  'title.plain': '開發地圖',

  'stat.ready': '現在可動',
  'stat.active': '有人接手',
  'stat.blocked': '被前置擋住',
  'stat.triage': '規格未定案',
  'stat.critical': '關鍵路徑',
  'stat.critical.unit': '張',

  'lede.allDone': '這個 repo 沒有未完成的票。',
  'lede.open': '{n} 張未完成。',
  'lede.ready': '<strong>現在可動 {n} 張，最前面是 {issues}</strong>。',
  'lede.none': '<strong>現在沒有可動的票</strong>——每一張都在等前置或等 triage。',
  'lede.blocked': '{n} 張被前置擋住。',
  'lede.triage': '{n} 張規格還沒定案，要先 triage。',
  'lede.critical': '關鍵路徑 {n} 張，那是最少要幾輪才收得完。',

  'foot.truth': '狀態的權威是 GitHub Issues。這一頁是快照，頁面上不能改狀態。',
  'foot.refresh': '重跑 {build} 產檔，或 {serve} 讓重新整理就是最新。',
  'foot.vocab': '這一次的判準：掛 {ready} 才算可動；掛 {unready} 或沒掛角色標籤算未定案。',
  'foot.noVocab': '這個 repo 沒有在用 triage 標籤，狀態只看阻擋與接手。',
  'join.or': ' 或 ',
  'join.slash': '／',
  'join.items': '、',

  'fold.collapse': '收起 #{n} 的子票',
  'fold.expand': '展開 #{n} 的子票',

  'map.stations': '{n} 站',
  'map.islandName': '無前置',
  'map.islandSub': '可各自開工',
  'legend.ready': '現在可動',
  'legend.active': '有人接手',
  'legend.blocked': '等前置',
  'legend.triage': '規格未定案',
  'legend.done': '已關閉',
  'legend.solid': '實線＝還沒解開的前置',
  'legend.dashed': '虛線＝前置已關',
  'node.aria': '#{n} {title}，{status}',

  'group.linked': '其他依賴鏈',
  'group.island': '獨立票',
  'group.orphan': '#{n} 的子票',
  'group.islandSub': '互不阻擋，可各自開工',
  'group.linkedSub': '有前置關係，但不屬於任何母票',
  'group.spec': '#{n} 母票規格',
  'group.progress': '子票 {done} / {total} 已完成 · 全關後才關 parent',
  'group.undrawn': '沒有畫圖——這一組裡沒有任何阻擋關係。票在下方清單。',

  'status.ready': '可接手',
  'status.active': '進行中',
  'status.blocked': '阻擋中',
  'status.triage': '待 triage',
  'status.done': '已完成',

  'step.active': '進行中',
  'step.manual': '人工實作',
  'step.waitIssues': '等 {issues}',
  'step.waitChildren': '等 {n} 張子票關完',
  'step.parentReady': '子票全關，可以關掉了',

  'detail.status': '狀態',
  'detail.next': '下一步',
  'detail.author': '開票',
  'detail.parent': '母票',
  'detail.waiting': '等誰',
  'detail.settled': '已解鎖的前置',
  'detail.unlocks': '關掉後解鎖',
  'detail.labels': '標籤',
  'detail.assignees': '接手',
  'detail.closedAt': ' {date} 關閉',
  'detail.open': '在 GitHub 開啟 ↗',
  'detail.empty': '沒有 issue',

  'row.waits': '等 {list}',

  'list.title': '清單',
  'list.count': '{n} 張',
  'tabs.aria': '狀態篩選',
  'tabs.all': '全部',

  'copy.title': '複製 {command}',
  'copy.done': '已複製',
  'copy.fail': '複製不了',
}

const ZH_CN: Messages = {
  'lang.label': '语言',

  'title.withRepo': '{repo} 开发地图',
  'title.plain': '开发地图',

  'stat.ready': '现在可动',
  'stat.active': '有人接手',
  'stat.blocked': '被前置挡住',
  'stat.triage': '规格未定案',
  'stat.critical': '关键路径',
  'stat.critical.unit': '张',

  'lede.allDone': '这个 repo 没有未完成的票。',
  'lede.open': '{n} 张未完成。',
  'lede.ready': '<strong>现在可动 {n} 张，最前面是 {issues}</strong>。',
  'lede.none': '<strong>现在没有可动的票</strong>——每一张都在等前置或等 triage。',
  'lede.blocked': '{n} 张被前置挡住。',
  'lede.triage': '{n} 张规格还没定案，要先 triage。',
  'lede.critical': '关键路径 {n} 张，那是最少要几轮才收得完。',

  'foot.truth': '状态的权威是 GitHub Issues。这一页是快照，页面上不能改状态。',
  'foot.refresh': '重跑 {build} 产文件，或 {serve} 让刷新就是最新。',
  'foot.vocab': '这一次的判准：挂 {ready} 才算可动；挂 {unready} 或没挂角色标签算未定案。',
  'foot.noVocab': '这个 repo 没有在用 triage 标签，状态只看阻挡与接手。',
  'join.or': ' 或 ',
  'join.slash': '／',
  'join.items': '、',

  'fold.collapse': '收起 #{n} 的子票',
  'fold.expand': '展开 #{n} 的子票',

  'map.stations': '{n} 站',
  'map.islandName': '无前置',
  'map.islandSub': '可各自开工',
  'legend.ready': '现在可动',
  'legend.active': '有人接手',
  'legend.blocked': '等前置',
  'legend.triage': '规格未定案',
  'legend.done': '已关闭',
  'legend.solid': '实线＝还没解开的前置',
  'legend.dashed': '虚线＝前置已关',
  'node.aria': '#{n} {title}，{status}',

  'group.linked': '其他依赖链',
  'group.island': '独立票',
  'group.orphan': '#{n} 的子票',
  'group.islandSub': '互不阻挡，可各自开工',
  'group.linkedSub': '有前置关系，但不属于任何母票',
  'group.spec': '#{n} 母票规格',
  'group.progress': '子票 {done} / {total} 已完成 · 全关后才关 parent',
  'group.undrawn': '没有画图——这一组里没有任何阻挡关系。票在下方清单。',

  'status.ready': '可接手',
  'status.active': '进行中',
  'status.blocked': '阻挡中',
  'status.triage': '待 triage',
  'status.done': '已完成',

  'step.active': '进行中',
  'step.manual': '人工实作',
  'step.waitIssues': '等 {issues}',
  'step.waitChildren': '等 {n} 张子票关完',
  'step.parentReady': '子票全关，可以关掉了',

  'detail.status': '状态',
  'detail.next': '下一步',
  'detail.author': '开票',
  'detail.parent': '母票',
  'detail.waiting': '等谁',
  'detail.settled': '已解锁的前置',
  'detail.unlocks': '关掉后解锁',
  'detail.labels': '标签',
  'detail.assignees': '接手',
  'detail.closedAt': ' {date} 关闭',
  'detail.open': '在 GitHub 打开 ↗',
  'detail.empty': '没有 issue',

  'row.waits': '等 {list}',

  'list.title': '清单',
  'list.count': '{n} 张',
  'tabs.aria': '状态筛选',
  'tabs.all': '全部',

  'copy.title': '复制 {command}',
  'copy.done': '已复制',
  'copy.fail': '复制不了',
}

const JA: Messages = {
  'lang.label': '言語',

  'title.withRepo': '{repo} 開発マップ',
  'title.plain': '開発マップ',

  'stat.ready': '着手できる',
  'stat.active': '対応中',
  'stat.blocked': '前提待ち',
  'stat.triage': '仕様未確定',
  'stat.critical': 'クリティカルパス',
  'stat.critical.unit': '件',

  'lede.allDone': 'この repo に未完了のチケットはありません。',
  'lede.open': '未完了 {n} 件。',
  'lede.ready': '<strong>着手できるのは {n} 件、先頭は {issues}</strong>。',
  'lede.none':
    '<strong>いま着手できるチケットはありません</strong>——すべて前提か triage 待ちです。',
  'lede.blocked': '{n} 件が前提で止まっています。',
  'lede.triage': '{n} 件は仕様が未確定で、まず triage が必要です。',
  'lede.critical': 'クリティカルパス {n} 件——最短でも何周かかるかを示します。',

  'foot.truth':
    '状態の正は GitHub Issues です。このページはスナップショットで、ここでは状態を変えられません。',
  'foot.refresh': 'ファイルを作り直すなら {build}、更新が常に最新になるのは {serve}。',
  'foot.vocab':
    '今回の判定基準：{ready} が付いていれば着手可。{unready} または役割ラベルなしは未確定。',
  'foot.noVocab':
    'この repo は triage ラベルを使っていないため、状態は前提と担当だけで決まります。',
  'join.or': ' または ',
  'join.slash': '／',
  'join.items': '、',

  'fold.collapse': '#{n} のサブチケットを折りたたむ',
  'fold.expand': '#{n} のサブチケットを開く',

  'map.stations': '{n} 駅',
  'map.islandName': '前提なし',
  'map.islandSub': 'それぞれ着手可',
  'legend.ready': '着手できる',
  'legend.active': '対応中',
  'legend.blocked': '前提待ち',
  'legend.triage': '仕様未確定',
  'legend.done': 'クローズ済み',
  'legend.solid': '実線＝未解決の前提',
  'legend.dashed': '破線＝前提はクローズ済み',
  'node.aria': '#{n} {title}、{status}',

  'group.linked': 'その他の依存チェーン',
  'group.island': '独立チケット',
  'group.orphan': '#{n} のサブチケット',
  'group.islandSub': '互いにブロックせず、それぞれ着手できる',
  'group.linkedSub': '依存関係はあるが、親チケットには属さない',
  'group.spec': '#{n} 親チケットの仕様',
  'group.progress': 'サブチケット {done} / {total} 完了 · すべて閉じてから親を閉じる',
  'group.undrawn':
    '図は描いていません——このグループにはブロック関係がありません。チケットは下の一覧にあります。',

  'status.ready': '着手可',
  'status.active': '対応中',
  'status.blocked': 'ブロック中',
  'status.triage': 'triage 待ち',
  'status.done': '完了',

  'step.active': '対応中',
  'step.manual': '人が実装',
  'step.waitIssues': '{issues} を待つ',
  'step.waitChildren': 'サブチケット {n} 件の完了を待つ',
  'step.parentReady': 'サブチケットは全て完了、閉じられます',

  'detail.status': '状態',
  'detail.next': '次の一手',
  'detail.author': '起票',
  'detail.parent': '親チケット',
  'detail.waiting': '待っているもの',
  'detail.settled': '解決済みの前提',
  'detail.unlocks': '閉じると動くもの',
  'detail.labels': 'ラベル',
  'detail.assignees': '担当',
  'detail.closedAt': ' {date} クローズ',
  'detail.open': 'GitHub で開く ↗',
  'detail.empty': 'issue がありません',

  'row.waits': '{list} を待つ',

  'list.title': '一覧',
  'list.count': '{n} 件',
  'tabs.aria': '状態で絞り込む',
  'tabs.all': 'すべて',

  'copy.title': '{command} をコピー',
  'copy.done': 'コピーしました',
  'copy.fail': 'コピーできません',
}

const DICTS: Readonly<Record<Locale, Messages>> = {
  en: EN,
  'zh-TW': ZH_TW,
  'zh-CN': ZH_CN,
  ja: JA,
}

// ---- 查表 ----

/**
 * 句子裡的代入名，從原稿的字面型別抽出來。少傳一個編不過——不然缺的那個會以 `{name}` 的樣子
 * 印在畫面上，而那要真的跑到那一格才看得到。
 */
type Names<S extends string> = S extends `${string}{${infer K}}${infer Rest}`
  ? K | Names<Rest>
  : never

type VarsOf<M> = M extends string
  ? Names<M>
  : M extends Plural
    ? 'n' | Names<M['one']> | Names<M['other']>
    : never

type Args<K extends MessageKey> = [VarsOf<(typeof EN)[K]>] extends [never]
  ? []
  : [vars: Readonly<Record<VarsOf<(typeof EN)[K]>, string | number>>]

/** 現在的語言只有這一份。畫面那一側先 `setLocale` 再整頁重畫。 */
let current: Locale = DEFAULT_LOCALE

export function locale(): Locale {
  return current
}

export function isLocale(value: string | null): value is Locale {
  return LOCALES.includes(value as Locale)
}

export function setLocale(next: Locale): void {
  current = next
}

const RULES = new Map<Locale, Intl.PluralRules>()

function pluralRules(of: Locale): Intl.PluralRules {
  const cached = RULES.get(of)
  if (cached) return cached
  const made = new Intl.PluralRules(of)
  RULES.set(of, made)
  return made
}

export function t<K extends MessageKey>(key: K, ...args: Args<K>): string {
  const vars = (args[0] ?? {}) as Readonly<Record<string, string | number>>
  const message: Message = DICTS[current][key]
  const text =
    typeof message === 'string'
      ? message
      : pluralRules(current).select(Number(vars.n)) === 'one'
        ? message.one
        : message.other
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}
