import { describe, expect, test } from 'bun:test'

import { criticalPathOf, groupsOf, type MapIssue, type Status } from '../scripts/issue-map-model.ts'

/**
 * 分群與關鍵路徑。地圖一張圖畫一群，統計那一格說「最少要幾輪」，兩者都由這裡算。
 */

function issue(
  number: number,
  extra: Partial<
    Pick<MapIssue, 'parent' | 'blockedBy' | 'waitingFor' | 'status' | 'isParent'>
  > = {},
): MapIssue {
  const blockedBy = extra.blockedBy ?? []
  const status: Status = extra.status ?? 'blocked'
  return {
    number,
    title: `票 ${number}`,
    url: `https://example.test/${number}`,
    closedAt: null,
    author: 'someone',
    labels: [],
    assignees: [],
    parent: extra.parent ?? null,
    blockedBy,
    waitingFor: extra.waitingFor ?? (status === 'done' ? [] : blockedBy),
    status,
    nextStep: { kind: 'none' },
    isParent: extra.isParent ?? false,
  }
}

describe('分群', () => {
  /**
   * 守的是「有前置關係的票不會被丟進『獨立票』」。
   *
   * 壞了會怎樣：一張擋著別人、但自己沒被擋的票會被歸成獨立票。地圖上它會出現在「互不阻擋，可
   * 各自開工」那一段，而它其實是別人的前置——讀圖的人會以為關掉它不影響任何人，排序時把它往
   * 後放，然後下游整條線一起卡著。
   *
   * 反向驗證（`bun run scripts/mutate.ts scripts/issue-map-model.ts tests/issue-map-groups.test.ts`）：
   * 把 `hasEdge` 那一行的 `||` 換成 `&&` 紅這一支；把 `issue.parent === null` 反過來紅 2 支
   * （這一支與下面的 parent 那一支），波及範圍解釋得通——兩支都在讀分群的結果。
   */
  test('擋著別人但自己沒被擋的票算有邊，不進獨立票', () => {
    // #1 擋著 #2，#1 自己沒有前置；#9 兩邊都沒有。
    const groups = groupsOf([issue(1), issue(2, { blockedBy: [1] }), issue(9)])

    const alone = groups.find((g) => g.name.kind === 'island')
    const linked = groups.find((g) => g.name.kind === 'linked')
    expect(linked?.members).toContain(1)
    expect(linked?.members).toContain(2)
    expect(alone?.members).toEqual([9])
  })

  /**
   * 守的是「子票掛在自己的 parent 底下，一張圖一群」。
   *
   * 壞了會怎樣：子票跑到別群或散進獨立票，地圖就不再是「一組子票一張圖」，而 parent 的進度
   * （子票幾張已完成）也會算錯。
   *
   * 反向驗證：把 `issue.parent === null` 反過來紅這一支；把 `grouped.has(...) || isParent`
   * 的 `||` 換成 `&&`，主票會同時被當成一張獨立票畫出來，也紅這一支。
   */
  test('子票歸到自己的 parent 底下，主票不會被畫兩次', () => {
    const groups = groupsOf([
      issue(100, { isParent: true }),
      issue(101, { parent: 100 }),
      issue(102, { parent: 100 }),
      issue(9),
    ])

    const family = groups.find((g) => g.parent === 100)
    expect(family?.members).toEqual([101, 102])
    // 群名帶的是主票標題本身，不是頁面上的分類字——那一句在 i18n 那一層才組出來。
    expect(family?.name).toEqual({ kind: 'spec', title: '票 100' })
    // parent 自己不當成員，它是那張圖的標頭；也不該再被歸進別群變成一個站點。
    const elsewhere = groups.filter((g) => g.parent === null).flatMap((g) => g.members)
    expect(elsewhere).not.toContain(100)
    expect(family?.members).not.toContain(100)
  })
})

describe('關鍵路徑', () => {
  /**
   * 守的是「關鍵路徑等於最長的一條依序未完成鏈」。
   *
   * 壞了會怎樣：統計那一格直接標「最少要幾輪才收得完」。算短了會讓人以為兩輪能收完一批其實
   * 要五輪的東西，那個數字是排程用的。
   *
   * 反向驗證：把 `Math.max` 換成 `Math.min` 紅這一支；把 `issue.status === 'done'` 反過來也
   * 紅這一支（已完成的票被算進鏈長）。
   */
  test('等於最長的那一條未完成鏈', () => {
    // 四站的鏈，加一張沒有前置的票——後者不該讓路徑變長。
    const chain = [
      issue(1),
      issue(2, { blockedBy: [1], waitingFor: [1] }),
      issue(3, { blockedBy: [2], waitingFor: [2] }),
      issue(4, { blockedBy: [3], waitingFor: [3] }),
      issue(9),
    ]
    expect(criticalPathOf(chain)).toBe(4)
  })

  /**
   * 已完成的票不算在鏈長裡——它已經不必再做一輪。
   *
   * 反向驗證：把 `issue.status === 'done'` 反過來，這一支與上面那一支都紅。
   */
  test('已完成的票不算一輪', () => {
    const chain = [
      issue(1, { status: 'done' }),
      issue(2, { status: 'done', blockedBy: [1] }),
      issue(3, { blockedBy: [2], waitingFor: [] }),
    ]
    // #3 還開著但它的前置都關了，所以只剩它自己那一輪。
    expect(criticalPathOf(chain)).toBe(1)
  })
})
