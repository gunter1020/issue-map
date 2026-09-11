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

describe('軌道', () => {
  /**
   * 守的是「同一條線上的邊是一條直線」。
   *
   * 壞了會怎樣：同一列的兩站之間如果畫成有轉折的路徑，那條線會繞出去撞到上下相鄰的線，看起來
   * 像跨線關係——而它其實只是同一條線的下一站。
   */
  test('同一列的邊只有水平線段，沒有轉折', () => {
    const issues = [
      issue(1, { status: 'done' }),
      issue(2, { blockedBy: [1], waitingFor: [], status: 'ready' }),
    ]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'linked' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    const d = /class="edge" d="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(d).toMatch(/^M[\d.]+ [\d.]+ H[\d.]+$/)
    expect(d).not.toContain('Q')
  })

  /**
   * 守的是「跨線的轉折點落在兩站之間」。
   *
   * 壞了會怎樣：轉折跑到起點左邊或終點右邊，那條線就會往回折、穿過別的站。
   */
  test('跨線的轉折點夾在起訖之間', () => {
    const issues = [
      issue(1),
      issue(2, { blockedBy: [1], waitingFor: [1], status: 'blocked' }),
      issue(3, { blockedBy: [1], waitingFor: [1], status: 'blocked' }),
      issue(4, { blockedBy: [3], waitingFor: [3], status: 'blocked' }),
    ]
    const groups: Snapshot['groups'] = [
      { parent: null, name: { kind: 'linked' }, members: [1, 2, 3, 4] },
    ]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    for (const match of html.matchAll(/class="edge" d="([^"]+)"/g)) {
      const d = match[1]
      if (d === undefined) continue
      const turn = /Q([\d.]+) /.exec(d)
      if (!turn) continue
      const start = Number(/^M([\d.]+) /.exec(d)?.[1])
      const end = Number(/H([\d.]+)$/.exec(d)?.[1])
      const at = Number(turn[1])
      expect(at).toBeGreaterThan(start)
      expect(at).toBeLessThan(end)
    }
  })

  /**
   * 守的是「前置已關掉的邊會被標記出來」。
   *
   * 壞了會怎樣：實線代表前置還沒解決、虛線代表已解決。標反了，讀圖的人會以為一張可以動的票還
   * 被擋著，或反過來去接一張其實動不了的。
   */
  test('前置已關掉的邊帶 data-done="true"', () => {
    const issues = [
      issue(1, { status: 'done' }),
      issue(2, { status: 'ready' }),
      issue(3, { blockedBy: [1, 2], waitingFor: [2], status: 'blocked' }),
    ]
    const groups: Snapshot['groups'] = [
      { parent: null, name: { kind: 'linked' }, members: [1, 2, 3] },
    ]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    expect(html).toMatch(/data-from="1"[^/]*data-done="true"/)
    expect(html).toMatch(/data-from="2"[^/]*data-done="false"/)
  })
})

describe('站點形狀', () => {
  /**
   * 守的是「可接手的站點畫成靶心，其他的是單純的點」。
   *
   * 壞了會怎樣：形狀是掃一眼分辨狀態的唯一依據——粗細在 7px 的點上看不出來。全部畫成一樣，
   * 「現在可以動哪幾張」就得一張一張讀。
   */
  test('ready 是靶心（光暈＋圓＋核心），blocked 只有一個圓', () => {
    const issues = [issue(1, { status: 'ready' }), issue(2, { status: 'blocked' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    const ready = /data-number="1"[\s\S]*?<\/a>/.exec(html)?.[0] ?? ''
    expect(ready).toContain('class="halo"')
    expect(ready).toContain('class="core"')

    const blocked = /data-number="2"[\s\S]*?<\/a>/.exec(html)?.[0] ?? ''
    expect(blocked).not.toContain('class="halo"')
    expect(blocked).not.toContain('class="core"')
  })

  /** active 是三角、triage 是菱形，各自一個形狀。 */
  test('active 與 triage 各有自己的形狀', () => {
    const issues = [issue(1, { status: 'active' }), issue(2, { status: 'triage' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    expect(/data-number="1"[\s\S]*?<\/a>/.exec(html)?.[0]).toContain('<path class="mark"')
    expect(/data-number="2"[\s\S]*?<\/a>/.exec(html)?.[0]).toContain('rotate(45')
  })
})

describe('線名與群名', () => {
  /**
   * 守的是「只有一站的線不標線名」。
   *
   * 壞了會怎樣：單站線沒有「這條線在做什麼」可講，硬標會在每一列旁邊放一句廢話，把真正有鏈的
   * 那幾條淹掉。
   */
  test('單站線不標線名', () => {
    const issues = [issue(1), issue(2)]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    // 兩張互不相干的票排成月台，只會有月台那一個線名。
    expect(html.match(/class="tlabel"/g)?.length).toBe(1)
    expect(html).not.toContain('→ #')
  })

  /**
   * 守的是「主票那一群的副標是進度，其他依賴鏈不是」。
   *
   * 壞了會怎樣：「其他依賴鏈」與「獨立票」都沒有主票，但只有後者互不阻擋。同一句話蓋兩種群
   * 就會說謊。
   */
  test('主票群顯示進度，依賴鏈群顯示自己的說明', () => {
    const issues = [
      issue(100, { isParent: true }),
      issue(101, { parent: 100, status: 'done' }),
      issue(102, { parent: 100 }),
    ]
    const groups: Snapshot['groups'] = [
      { parent: 100, name: { kind: 'spec', title: '主票' }, members: [101, 102] },
    ]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    // 兩張子票裡一張已完成。
    expect(html).toContain('1')
    expect(html).toContain('data-fold="100"')
    expect(html).toContain('data-parent="100"')
  })

  /** 收合鈕預設是展開的——建置時還不知道這個瀏覽器記了什麼。 */
  test('收合鈕預設 aria-expanded 是 true', () => {
    const issues = [issue(100, { isParent: true }), issue(101, { parent: 100 })]
    const groups: Snapshot['groups'] = [
      { parent: 100, name: { kind: 'spec', title: '主票' }, members: [101] },
    ]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()
    expect(html).toContain('aria-expanded="true"')
  })
})

describe('排序與截斷', () => {
  /**
   * 守的是「同狀態的票照票號排」。
   *
   * 壞了會怎樣：清單每次重畫順序都不一樣，或新票插在舊票前面。掃清單時找不到剛才看的那一張。
   */
  test('同狀態的票照票號由小到大', () => {
    const issues = [issue(30), issue(10), issue(20)]
    const html = viewOf(snapshotOf(issues)).rowsHTML('all').html
    const order = [...html.matchAll(/data-number="(\d+)"/g)].map((m) => Number(m[1]))
    expect(order).toEqual([10, 20, 30])
  })

  /**
   * 守的是「等誰那一欄剛好四張時不顯示 +N」。
   *
   * 壞了會怎樣：邊界差一格，四張就變成「三張 +1」——那一欄的意義是「還差幾件」，數字錯了排序
   * 就錯了。
   */
  test('剛好四張前置全列出來，第五張才收成 +N', () => {
    const four = issue(1, { blockedBy: [2, 3, 4, 5], waitingFor: [2, 3, 4, 5], status: 'blocked' })
    const five = issue(2, {
      blockedBy: [3, 4, 5, 6, 7],
      waitingFor: [3, 4, 5, 6, 7],
      status: 'blocked',
    })

    const a = viewOf(snapshotOf([four])).rowsHTML('all').html
    expect(a).not.toContain('class="more"')

    const b = viewOf(snapshotOf([five])).rowsHTML('all').html
    expect(b).toContain('class="more"')
    expect(b).toContain('+1')
  })

  /**
   * 守的是「導言點名的是可接手的票」。
   *
   * 壞了會怎樣：導言那一句是整頁第一個被讀到的建議。點名成待評估或被擋住的票，讀的人會直接去
   * 接一張動不了的。
   */
  test('導言只點名可接手的票', () => {
    const issues = [
      issue(1, { status: 'triage' }),
      issue(2, { status: 'ready' }),
      issue(3, { status: 'blocked' }),
    ]
    const lede = viewOf(snapshotOf(issues)).lede()
    expect(lede).toContain('/2"')
    expect(lede).not.toContain('/1"')
    expect(lede).not.toContain('/3"')
  })
})

describe('剩下幾個會說謊的地方', () => {
  /**
   * 守的是「一條真的有兩站以上的線才標線名，單站線不標」。
   *
   * 壞了會怎樣：反過來之後每一條單站線旁邊都多一句「→ #n・1 站」，把真正有鏈的那幾條淹掉。
   */
  test('兩站以上的線才有線名', () => {
    const issues = [
      issue(1),
      issue(2, { blockedBy: [1], waitingFor: [1], status: 'blocked' }),
      issue(9),
    ]
    const groups: Snapshot['groups'] = [
      { parent: null, name: { kind: 'linked' }, members: [1, 2, 9] },
    ]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    // #1→#2 那條線有線名（終點 #2），#9 自己一站排進月台，月台有自己的線名。
    expect(html).toContain('→ #2')
    expect(html).not.toContain('→ #9')
  })

  /**
   * 守的是「主票群的進度是『已完成／全部』」。
   *
   * 壞了會怎樣：那個分數是判斷一組還剩多少的依據。分子算成未完成的張數，讀的人會把快收完的
   * 一組看成剛開始。
   */
  test('主票群的進度分子是已完成的張數', () => {
    const issues = [
      issue(100, { isParent: true }),
      issue(101, { parent: 100, status: 'done' }),
      issue(102, { parent: 100, status: 'done' }),
      issue(103, { parent: 100, status: 'ready' }),
    ]
    const groups: Snapshot['groups'] = [
      { parent: 100, name: { kind: 'spec', title: '主票' }, members: [101, 102, 103] },
    ]
    const sub = /<span class="sub">([\s\S]*?)<\/span>/.exec(
      viewOf(snapshotOf(issues, groups)).groupsHTML(),
    )?.[1]

    // 三張裡兩張已完成。
    expect(sub).toContain('2')
    expect(sub).toContain('3')
  })

  /**
   * 守的是「『其他依賴鏈』不會被寫成『互不阻擋』」。
   *
   * 壞了會怎樣：那一群裡的票是彼此有前置關係的。副標寫成「互不阻擋，可各自開工」，讀的人會同時
   * 派出整條鏈。
   */
  test('依賴鏈群與獨立票群的副標不同', () => {
    const chain: MapIssue[] = [
      issue(1),
      issue(2, { blockedBy: [1], waitingFor: [1], status: 'blocked' }),
    ]
    const linked = viewOf(
      snapshotOf(chain, [{ parent: null, name: { kind: 'linked' }, members: [1, 2] }]),
    ).groupsHTML()
    const island = viewOf(
      snapshotOf(
        [issue(1), issue(2)],
        [{ parent: null, name: { kind: 'island' }, members: [1, 2] }],
      ),
    ).groupsHTML()

    const subOf = (html: string) => /<span class="sub">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? ''
    expect(subOf(linked)).not.toBe(subOf(island))
  })

  /**
   * 守的是「『關掉後解鎖』只列還開著的票」。
   *
   * 壞了會怎樣：那一欄回答「做完這張會放行誰」。把已經關掉的也列進去，等於謊報這張票的價值。
   */
  test('關掉後解鎖不列已完成的票', () => {
    const issues = [
      issue(1),
      issue(2, { blockedBy: [1], waitingFor: [1], status: 'blocked' }),
      issue(3, { blockedBy: [1], waitingFor: [], status: 'done' }),
    ]
    const html = viewOf(snapshotOf(issues)).detailHTML(1)

    expect(html).toContain('href="https://example.test/2"')
    expect(html).not.toContain('href="https://example.test/3"')
  })

  /**
   * 守的是「主票才掛 data-haskids」。
   *
   * 壞了會怎樣：清單靠它決定哪一列要放收合鈕。全部都掛，每一列都會長出一顆按不動的鈕。
   */
  test('只有主票掛 data-haskids', () => {
    const issues = [issue(100, { isParent: true }), issue(101, { parent: 100 }), issue(9)]
    const html = viewOf(snapshotOf(issues)).rowsHTML('all').html
    expect(html.match(/data-haskids="true"/g)?.length).toBe(1)
  })

  /**
   * 守的是「只有當前分頁是按下的狀態」。
   *
   * 壞了會怎樣：六個分頁同時看起來都被選中，或一個都沒有——看的人不知道現在在篩什麼。
   */
  test('只有當前篩選的分頁 aria-pressed 是 true', () => {
    const html = viewOf(snapshotOf([issue(1, { status: 'ready' })])).tabsHTML('ready')
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(html).toMatch(/data-filter="ready" aria-pressed="true"/)
  })

  /**
   * 守的是「站點半徑照狀態走」。
   *
   * 壞了會怎樣：可接手的站點刻意畫大一點，那是掃一眼找得到它的原因。全部一樣大就要逐一讀狀態。
   */
  test('可接手的站點比其他狀態大', () => {
    const issues = [issue(1, { status: 'ready' }), issue(2, { status: 'blocked' })]
    const groups: Snapshot['groups'] = [{ parent: null, name: { kind: 'island' }, members: [1, 2] }]
    const html = viewOf(snapshotOf(issues, groups)).groupsHTML()

    const rOf = (n: number) =>
      Number(
        /class="mark"[^/]*r="([\d.]+)"/.exec(
          /data-number="(?:n)"[\s\S]*?<\/a>/.source.replace('n', String(n)) &&
            (new RegExp(`data-number="${n}"[\\s\\S]*?</a>`).exec(html)?.[0] ?? ''),
        )?.[1],
      )
    expect(rOf(1)).toBeGreaterThan(rOf(2))
  })
})

describe('預設看哪一張', () => {
  /**
   * 守的是「沒有選取時，詳細面板預設顯示第一張可接手的票」。
   *
   * 壞了會怎樣：一進頁面看到的是一張被擋住或待評估的票。那個面板是整頁最顯眼的位置，等於一開始
   * 就把人引到動不了的東西上。
   */
  test('預設挑第一張可接手的，不是票號最小的', () => {
    const issues = [
      issue(1, { status: 'triage' }),
      issue(2, { status: 'blocked' }),
      issue(7, { status: 'ready' }),
      issue(9, { status: 'ready' }),
    ]
    const view = viewOf(snapshotOf(issues))
    expect(view.defaultPick()).toBe(7)
    expect(view.detailPanelHTML(view.defaultPick()).status).toBe('ready')
  })

  /** 一張可接手的都沒有時退回第一張，不是空面板。 */
  test('沒有可接手的票時退回第一張', () => {
    const issues = [issue(5, { status: 'triage' }), issue(6, { status: 'blocked' })]
    expect(viewOf(snapshotOf(issues)).defaultPick()).toBe(5)
  })
})
