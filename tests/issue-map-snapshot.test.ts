import { describe, expect, test } from 'bun:test'

import {
  assemble,
  keptClosed,
  parentInBody,
  type RawIssue,
  wantedClosed,
  withParent,
} from '../src/issue-map.ts'

/**
 * 抓回來之後的推導：要指名去要哪幾張 closed、怎麼折成一份快照。
 *
 * 抓取本身（組查詢、翻頁、`gh` 的離開碼）要真的打 GitHub，這裡只驗不需要網路的那一段——也就是
 * 決定打什麼請求的規則，與拿到回應之後算出來的東西。
 */

function raw(number: number, extra: Partial<RawIssue> = {}): RawIssue {
  return {
    number,
    title: `票 ${number}`,
    state: 'OPEN',
    url: `https://example.test/${number}`,
    body: '',
    closedAt: null,
    author: { login: 'someone' },
    parent: null,
    labels: { nodes: [] },
    assignees: { nodes: [] },
    blockedBy: { nodes: [] },
    ...extra,
  }
}

const blockedBy = (...numbers: number[]) => ({ nodes: numbers.map((number) => ({ number })) })
const labelled = (...names: string[]) => ({ nodes: names.map((name) => ({ name })) })

describe('內文裡的 parent', () => {
  /**
   * 守的是「原生 sub-issue 優先於內文慣例」。
   *
   * 壞了會怎樣：兩邊都有值而讀錯邊的話，整組的歸屬會照一段沒人維護的內文走，而不是 GitHub 上
   * 真正的 sub-issue 關係——地圖分組跟 GitHub 看到的就對不起來。
   */
  test('有原生 parent 就不看內文', () => {
    const issue = withParent(raw(5, { parent: { number: 9 }, body: '## Parent\n\n#77' }), 'Parent')
    expect(issue.parentNumber).toBe(9)
  })

  /** 沒有原生關係時才讀內文的 `## <標題>` 之後第一個票號。 */
  test('沒有原生 parent 就讀內文標題後的第一個票號', () => {
    expect(parentInBody('## Parent\n\n見 #77 與 #88', 'Parent')).toBe(77)
  })

  /**
   * 守的是「內文裡別處的 `#數字` 不會被當成 parent」。
   *
   * 壞了會怎樣：一般的交叉引用（「跟 #12 有關」）會把票掛到不相干的主票底下，那一組的進度與
   * 收合全跟著錯。
   */
  test('沒有那個標題就沒有 parent', () => {
    expect(parentInBody('跟 #12 有關', 'Parent')).toBeNull()
  })

  /**
   * 守的是「沒設標題就完全不讀內文」。
   *
   * 壞了會怎樣：沒設標題時內文根本沒被抓下來，所以這條路必須是關的；真的去讀的話，只有在某些
   * repo 才有內文的情況下會讀到不一致的結果。
   */
  test('標題是空的就不讀內文', () => {
    expect(parentInBody('## Parent\n\n#77', '')).toBeNull()
    expect(withParent(raw(5, { body: '## Parent\n\n#77' }), '').parentNumber).toBeNull()
  })
})

describe('要指名去要哪幾張 closed', () => {
  /**
   * 守的是「只要不在 open 那包的阻擋者與 parent」。
   *
   * 壞了會怎樣：多要已經在手上的票是白打一趟請求；少要的話，被 open 票牽著的已完成前置就不會
   * 進快照，圖上那一段依賴鏈會斷掉。
   */
  test('阻擋者與 parent 都要，已經在 open 的不要', () => {
    const open = [raw(1, { blockedBy: blockedBy(2, 50) }), raw(2, { parent: { number: 90 } })].map(
      (issue) => withParent(issue),
    )

    const wanted = wantedClosed(open)
    expect(wanted.numbers.toSorted((a, b) => a - b)).toEqual([50, 90])
    expect(wanted.parents).toEqual([90])
  })

  /** 同一張票同時是好幾張的阻擋者時只要一次。 */
  test('重複的票號收斂成一個', () => {
    const open = [raw(1, { blockedBy: blockedBy(9) }), raw(2, { blockedBy: blockedBy(9) })].map(
      (issue) => withParent(issue),
    )
    expect(wantedClosed(open).numbers).toEqual([9])
  })
})

describe('指名要回來之後留下哪些', () => {
  /**
   * 守的是「只留已經關掉的」。
   *
   * 壞了會怎樣：還開著的兄弟票本來就在 open 那包，再留一份就是同一張票進快照兩次——清單會出現
   * 兩列同號的票，統計也跟著多算。
   */
  test('還開著的不留', () => {
    const open = [raw(1)].map((issue) => withParent(issue))
    const fetched = [raw(2), raw(3, { state: 'CLOSED' })]

    expect(keptClosed(open, fetched).map((issue) => issue.number)).toEqual([3])
  })

  /** 已經在 open 那包的票不會再留一份，即使 GitHub 把它當 closed 回來。 */
  test('已經在 open 那包的不留', () => {
    const open = [raw(1)].map((issue) => withParent(issue))
    expect(keptClosed(open, [raw(1, { state: 'CLOSED' })])).toEqual([])
  })

  /** 同一張票被兩條路徑要回來（既是阻擋者又是兄弟）時收斂成一張。 */
  test('重複要回來的票收斂成一張', () => {
    const fetched = [raw(9, { state: 'CLOSED' }), raw(9, { state: 'CLOSED' })]
    expect(keptClosed([], fetched).map((issue) => issue.number)).toEqual([9])
  })
})

describe('折成快照', () => {
  /**
   * 守的是「主票的狀態看的是還開著的子票，不是自己的阻擋者」。
   *
   * 壞了會怎樣：主票自己不做事，子票全關了它就該可以收尾。數錯的話一張已經做完的規格會一直
   * 顯示成還在等，讀圖的人不知道該收它。
   */
  test('還開著的子票才算進主票的等待', () => {
    // 開著與關掉的張數刻意不同：一樣的話，數錯邊也會得到同一個數字。
    const open = [raw(1), raw(2, { parent: { number: 1 } }), raw(3, { parent: { number: 1 } })].map(
      (issue) => withParent(issue),
    )
    const closed = [
      raw(4, { parent: { number: 1 }, state: 'CLOSED', closedAt: '2026-01-01T00:00:00.000Z' }),
    ].map((issue) => withParent(issue))

    const snapshot = assemble('owner/repo', open, closed)
    const parent = snapshot.issues.find((issue) => issue.number === 1)

    expect(parent?.isParent).toBe(true)
    expect(parent?.status).toBe('blocked')
    expect(parent?.nextStep).toEqual({ kind: 'waitChildren', count: 2 })
  })

  /**
   * 守的是「這個 repo 沒在用 triage 標籤時就不把它當閘門」。
   *
   * 壞了會怎樣：一張都沒掛的 repo 會每張票都變成待 triage，整張圖說沒有任何事可以動；而頁尾
   * 讀的就是這個判定，說詞也會跟著錯。
   */
  test('一張角色標籤都沒看到就不套閘門', () => {
    const snapshot = assemble(
      'owner/repo',
      [raw(1)].map((issue) => withParent(issue)),
      [],
    )

    expect(snapshot.labels.gated).toBe(false)
    expect(snapshot.issues[0]?.status).toBe('ready')
  })

  /** 看得到任何一個角色標籤，閘門就套上，沒掛的票變成待 triage。 */
  test('看得到角色標籤就套閘門', () => {
    const open = [raw(1, { labels: labelled('ready-for-agent') }), raw(2)].map((issue) =>
      withParent(issue),
    )
    const snapshot = assemble('owner/repo', open, [])

    expect(snapshot.labels.gated).toBe(true)
    expect(snapshot.issues.find((issue) => issue.number === 1)?.status).toBe('ready')
    expect(snapshot.issues.find((issue) => issue.number === 2)?.status).toBe('triage')
  })

  /**
   * 守的是「只有還開著的阻擋者算閘門」。
   *
   * 壞了會怎樣：已經關掉的前置還被當成在擋，一張其實可以動的票會顯示成 blocked——那正是這張圖
   * 要回答的問題。
   */
  test('已關掉的阻擋者不再是閘門', () => {
    const open = [raw(1, { blockedBy: blockedBy(2) })].map((issue) => withParent(issue))
    const closed = [raw(2, { state: 'CLOSED', closedAt: '2026-01-01T00:00:00.000Z' })].map(
      (issue) => withParent(issue),
    )

    const issue = assemble('owner/repo', open, closed).issues.find((i) => i.number === 1)
    expect(issue?.blockedBy).toEqual([2])
    expect(issue?.waitingFor).toEqual([])
    expect(issue?.status).toBe('ready')
  })

  /** 票照票號排序，兩邊的票混在一起也是同一條規則。 */
  test('票照票號排序', () => {
    const open = [raw(5), raw(1)].map((issue) => withParent(issue))
    const closed = [raw(3, { state: 'CLOSED' })].map((issue) => withParent(issue))

    expect(assemble('owner/repo', open, closed).issues.map((issue) => issue.number)).toEqual([
      1, 3, 5,
    ])
  })
})
