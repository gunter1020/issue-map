import { describe, expect, test } from 'bun:test'

import { layoutOf, MAP, type MapIssue } from '../scripts/issue-map-model.ts'

/**
 * 線路圖的排版。
 *
 * 這一組守四件會讓地圖說謊或不能看的事，其餘（顏色、形狀、間距）刻意不驗——那些是外觀，改了
 * 不該紅。
 *
 * 反向驗證跑完的結論：`bun run mutate scripts/issue-map-model.ts` 全套 12 個 mutant 全部被殺，
 * 一個 mutant 平均紅 1.8 支。紅最多的是環守衛與層級那幾行（4 支、3 支），波及範圍解釋得通
 * ——那幾支都在讀層級算出來的位置。
 *
 * （搬到這個 repo 之後重跑過一次：12／12 不變，平均從 1.9 變 1.8，因為「全套」現在只有這兩支
 * 測試檔，不再包含 trpg-keeper 其餘的測試。）
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
    nextStep: '',
    isParent: false,
  }
}

describe('線路圖排版', () => {
  /**
   * 守的是「每一站都排在它前置的右邊」。
   *
   * 壞了會怎樣：`railPath` 一律畫「向右、轉、向右」，所以一條往左的邊會沿著反方向穿過中間那
   * 幾站。讀圖的人會把「A 擋 B」看成「B 擋 A」，然後去接一張其實還被擋住的票。
   *
   * 反向驗證（`bun run scripts/mutate.ts scripts/issue-map-model.ts tests/issue-map-layout.test.ts`）：
   * 把 `longestPath` 的 `Math.max` 換成 `Math.min`，層級不再是最長路徑，紅 2 支（這一支與
   * 「月台排在線後面」，後者也依賴層級）；把它的環守衛 `!==` 反過來也紅 2 支。波及範圍解釋得
   * 通——那兩支都在讀層級算出來的位置。
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
   * 壞了會怎樣：實際發生過——`nueip/research-api` 的一組有十二張彼此沒有前置關係的票，那時每
   * 一張各佔一條單站線，圖高十二列、線名欄重複十二次同一件事，而且要橫向捲才看得完。
   *
   * 反向驗證：把 `hasEdge` 那一行的 `||` 換成 `&&`（等於幾乎沒有票算「有邊」）紅這一支；把
   * 挑鏈時的 `back === undefined` 反過來紅 2 支。都只紅讀得到線與月台的那幾支。
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
   *
   * 反向驗證：把 `perRow` 的 `Math.max` 換成 `Math.min` 紅這一支，因為月台一列只放一個、
   * 列數變多。
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
   * 壞了會怎樣：實際發生過——畫布寬度沒算進站名的伸出量，最後一站的名字被容器裁掉，那張票在
   * 圖上只剩半個名字。深的鏈也會整條被擠出畫布右緣。
   *
   * 反向驗證：把 `depth` 的 `Math.max` 換成 `Math.min` 紅這一支（深鏈的寬度算成一站）；把
   * `perRow` 的那個 `Math.max` 換成 `Math.min` 也紅這一支。
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
