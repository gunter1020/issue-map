import { describe, expect, test } from 'bun:test'

import { DEFAULT_LOCALE, setLocale } from '../scripts/issue-map-i18n.ts'
import type { MapIssue, Snapshot, Status } from '../scripts/issue-map-model.ts'
import { viewOf } from '../scripts/issue-map-view.ts'

/**
 * 畫出來的標記。建置時與瀏覽器裡用的是同一批函式，所以這裡守的是兩邊共同的產出。
 *
 * 只驗「壞了地圖就說謊或不能看」的部分，外觀（顏色、間距）刻意不驗。
 */

setLocale(DEFAULT_LOCALE)

function issue(number: number, extra: Partial<MapIssue> = {}): MapIssue {
  return {
    number,
    title: `票 ${number}`,
    url: `https://example.test/${number}`,
    closedAt: null,
    author: 'someone',
    labels: [],
    assignees: [],
    parent: null,
    blockedBy: [],
    waitingFor: [],
    status: 'ready',
    nextStep: { kind: 'none' },
    isParent: false,
    ...extra,
  }
}

function snapshotOf(issues: MapIssue[], groups: Snapshot['groups'] = []): Partial<Snapshot> {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    repo: 'owner/repo',
    labels: { ready: [], unready: [] },
    groups,
    criticalPath: 1,
    issues,
  }
}

describe('站點', () => {
  /**
   * 守的是「每個站點都帶著自己的票號與狀態」。
   *
   * 壞了會怎樣：畫面那一支靠 `data-number` 找被點的是哪一張、靠 `data-status` 決定形狀。少了
   * 任何一個，點站點就選不到票，或是所有票畫成同一種形狀——讀圖的人分不出誰可以動。
   */
  test('帶著票號與狀態，而且是連到 GitHub 的連結', () => {
    const issues = [issue(1, { status: 'ready' }), issue(2, { status: 'triage' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    expect(html).toContain('data-number="1"')
    expect(html).toContain('data-status="ready"')
    expect(html).toContain('data-number="2"')
    expect(html).toContain('data-status="triage"')
    expect(html).toContain('href="https://example.test/1"')
  })

  /**
   * 守的是「標題會被逃脫」。
   *
   * 壞了會怎樣：票的標題是 GitHub 上任何人都能寫的字。沒逃脫就等於讓外人的字直接變成這一頁的
   * 標記，畫面會被改掉甚至塞進腳本。
   */
  test('標題裡的角括號被逃脫', () => {
    const issues = [issue(1, { title: '<img src=x onerror=alert(1)>' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})

describe('線名', () => {
  /**
   * 守的是「線名畫在 SVG 外面的 HTML 欄位」。
   *
   * 壞了會怎樣：SVG 的 `<text>` 不會換行也不會自己截斷，長一點的線名（每種語言長度不同）會直接
   * 蓋到第一個站點上。搬回 SVG 裡就得靠 JS 量寬度再壓縮，而沒有 JS 的環境量不了。
   */
  test('是 HTML 的 .tlabel，不是 SVG 的 text', () => {
    const issues = [issue(1), issue(2, { blockedBy: [1], waitingFor: [1], status: 'blocked' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'linked' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    expect(html).toContain('class="tlabel"')
    expect(html).not.toContain('class="tname"')
    expect(html).not.toContain('class="tsub"')
    // 線名在 svg 開始之前，不然它就還在 SVG 裡面。
    expect(html.indexOf('class="tlabel"')).toBeLessThan(html.indexOf('<svg'))
  })
})

describe('清單', () => {
  /**
   * 守的是「篩選只留下該狀態的票」。
   *
   * 壞了會怎樣：分頁上寫著「可接手 2」，點進去卻是全部四張——那個數字是拿來排工作的。
   */
  test('篩選後只剩該狀態的票', () => {
    const issues = [
      issue(1, { status: 'ready' }),
      issue(2, { status: 'triage' }),
      issue(3, { status: 'ready' }),
    ]
    const view = viewOf(snapshotOf(issues))

    const all = view.rowsHTML('all')
    expect(all.shown).toBe(3)

    const ready = view.rowsHTML('ready')
    expect(ready.shown).toBe(2)
    expect(ready.html).toContain('data-number="1"')
    expect(ready.html).toContain('data-number="3"')
    expect(ready.html).not.toContain('data-number="2"')
  })

  /**
   * 守的是「子票掛在主票底下，而且帶著 data-parent」。
   *
   * 壞了會怎樣：收合主票時 `paintFolded` 靠 `data-parent` 把子票藏起來。少了它，收合主票以後
   * 子票還留在畫面上，看起來像沒有歸屬的孤票。
   */
  test('子票排在主票後面並帶著 data-parent', () => {
    const issues = [issue(100, { isParent: true, status: 'blocked' }), issue(101, { parent: 100 })]
    const html = viewOf(snapshotOf(issues)).rowsHTML('all').html

    expect(html.indexOf('data-number="100"')).toBeLessThan(html.indexOf('data-number="101"'))
    expect(html).toContain('data-parent="100"')
    // 主票要有收合鈕，而且鈕指向自己。
    expect(html).toContain('data-fold-for="100"')
  })

  /** 主票不算進「幾張票」——它自己不做事。 */
  test('主票不計入張數', () => {
    const issues = [issue(100, { isParent: true }), issue(101, { parent: 100 })]
    expect(viewOf(snapshotOf(issues)).rowsHTML('all').shown).toBe(1)
  })
})

describe('分頁', () => {
  /**
   * 守的是「分頁上的數字等於該狀態實際有幾張」。
   *
   * 壞了會怎樣：那排數字是掃一眼就決定今天做什麼的依據，算錯就是排錯工作。
   */
  test('數字等於各狀態的張數，主票不算', () => {
    const issues = [
      issue(1, { status: 'ready' }),
      issue(2, { status: 'ready' }),
      issue(3, { status: 'triage' }),
      issue(100, { isParent: true, status: 'blocked' }),
    ]
    const html = viewOf(snapshotOf(issues)).tabsHTML('all')

    expect(html).toContain('>3</span>') // all：三張，主票不算
    expect(html).toMatch(/data-filter="ready"[^>]*>[^<]*<span class="n">2</)
    expect(html).toMatch(/data-filter="triage"[^>]*>[^<]*<span class="n">1</)
    expect(html).toContain('aria-pressed="true"')
  })
})

describe('詳細', () => {
  /**
   * 守的是「等誰與已解鎖分開列」。
   *
   * 壞了會怎樣：`blockedBy` 含已關掉的前置，`waitingFor` 只含還開著的。兩者混在一起，讀圖的人
   * 會以為一張其實可以動的票還被擋著。
   */
  test('還開著的前置列在等誰，已關掉的列在已解鎖', () => {
    const issues = [
      issue(1, { status: 'done' }),
      issue(2, { status: 'ready' }),
      issue(3, { blockedBy: [1, 2], waitingFor: [2], status: 'blocked' }),
    ]
    const html = viewOf(snapshotOf(issues)).detailHTML(3)

    expect(html).toContain('#3')
    // #2 還開著＝閘門；#1 已關＝已解決的前置。兩者都要出現，但在不同列。
    expect(html).toContain('href="https://example.test/2"')
    expect(html).toContain('href="https://example.test/1"')
  })

  /** 查不到的票回空字串，不是半張面板。 */
  test('票不存在時回空字串', () => {
    expect(viewOf(snapshotOf([issue(1)])).detailHTML(999)).toBe('')
  })
})

describe('狀態數字', () => {
  /**
   * 守的是「統計格的數字來自實際的票」。
   *
   * 壞了會怎樣：抬頭那排是整頁最先被讀到的東西，錯了整張圖的可信度就沒了。
   */
  test('可接手與待評估的數字對得上', () => {
    const statuses: Status[] = ['ready', 'ready', 'triage', 'blocked', 'done']
    const issues = statuses.map((status, index) => issue(index + 1, { status }))
    const html = viewOf(snapshotOf(issues)).statsHTML()

    expect(html).toMatch(/data-tone="ready"><b>2/)
    expect(html).toMatch(/data-tone="triage"><b>1/)
    // blocked 那格帶著「/ 還開著幾張」，done 不算在裡面。
    expect(html).toMatch(/data-tone="blocked"><b>1<small>\/ 4/)
  })
})
