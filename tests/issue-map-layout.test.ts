import { describe, expect, test } from 'bun:test'

import { layoutOf, MAP, type MapIssue } from '../scripts/issue-map-model.ts'

/**
 * 線路圖的排版。
 *
 * 這一組守四件會讓地圖說謊或不能看的事，其餘（顏色、形狀、間距）刻意不驗——那些是外觀，改了
 * 不該紅。
 */

function issue(number: number, blockedBy: number[] = []): MapIssue {
  return {
    number,
    title: `票 ${number}`,
    url: `https://example.test/${number}`,
    closedAt: null,
    author: 'someone',
    labels: [],
    assignees: [],
    parent: null,
    blockedBy,
    waitingFor: blockedBy,
    status: 'blocked',
    nextStep: { kind: 'none' },
    isParent: false,
  }
}

describe('線路圖排版', () => {
  /**
   * 守的是「每一站都排在它前置的右邊」。
   *
   * 壞了會怎樣：`railPath` 一律畫「向右、轉、向右」，所以一條往左的邊會沿著反方向穿過中間那
   * 幾站。讀圖的人會把「A 擋 B」看成「B 擋 A」，然後去接一張其實還被擋住的票。
   */
  test('每一站都排在它所有前置的右邊', () => {
    // 一條四站的鏈，加一張跨線指過來的票。
    const members = [issue(1), issue(2, [1]), issue(3, [2]), issue(4, [3]), issue(5, [1, 3])]
    const layout = layoutOf(members)

    for (const edge of layout.edges) {
      const from = layout.xy.get(edge.from)
      const to = layout.xy.get(edge.to)
      expect(from).toBeDefined()
      expect(to).toBeDefined()
      expect(to!.x).toBeGreaterThan(from!.x)
    }
  })

  /**
   * 守的是「組裡互不相干的票排成月台，不是一票一條線」。
   *
   * 壞了會怎樣：一組十幾張彼此沒有前置關係的票會各佔一條單站線，圖高十幾列、線名欄重複同一
   * 件事，而且要橫向捲才看得完。
   */
  test('互不相干的票排成一片月台，不是一票一條線', () => {
    const members = [1, 2, 3, 4, 5, 6].map((n) => issue(n))
    const layout = layoutOf(members)

    expect(layout.tracks).toHaveLength(0)
    expect(layout.islandRows).toBeGreaterThan(0)

    // 六張票不該站成六列。
    const rows = new Set([...layout.xy.values()].map((point) => point.y))
    expect(rows.size).toBeLessThan(members.length)
  })

  /**
   * 有前置關係的票走線、沒有的走月台，兩者同時存在時月台排在線的後面——不然月台會蓋在線上。
   */
  test('月台排在所有線的後面', () => {
    const members = [issue(1), issue(2, [1]), issue(9), issue(10)]
    const layout = layoutOf(members)

    expect(layout.tracks).toHaveLength(1)
    const lastTrackY = MAP.top + (layout.tracks.length - 1) * MAP.row
    const islandY = layout.xy.get(9)?.y
    expect(islandY).toBeGreaterThan(lastTrackY)
  })

  /**
   * 守的是「畫布放得下每一站，連最後一站往右伸出去的站名也放得下」。
   *
   * 壞了會怎樣：畫布寬度沒算進站名的伸出量時，最後一站的名字會被容器裁掉，那張票在圖上只剩
   * 半個名字；深的鏈也會整條被擠出畫布右緣。
   */
  test('畫布放得下最深的鏈與最後一站的站名', () => {
    // 六站的鏈：深度大於月台的下限，寬度得跟著深度長。
    const chain = [1, 2, 3, 4, 5, 6].map((n) => issue(n, n === 1 ? [] : [n - 1]))
    const layout = layoutOf(chain)

    const overhang = MAP.rightPad
    for (const point of layout.xy.values()) {
      expect(point.x).toBeGreaterThanOrEqual(MAP.gutter)
      expect(point.x + overhang).toBeLessThanOrEqual(layout.width)
    }
  })
})
