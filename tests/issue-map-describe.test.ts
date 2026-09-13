import { describe, expect, test } from 'bun:test'

import type { MapIssue, Snapshot, Status } from '../scripts/issue-map-model.ts'
import { describe as describeSnapshot } from '../scripts/issue-map.ts'

/**
 * 跑完之後印出來的那一句話。`bun run issue-map` 與 server 每次重抓都靠它回報這次抓到什麼，
 * 而它是唯一的輸出——數字說反話的話，沒有別的地方看得出來。
 */

const AT = '2026-01-02T03:04:05.000Z'

function issue(number: number, status: Status): MapIssue {
  return {
    number,
    title: `票 ${number}`,
    url: `https://example.test/${number}`,
    closedAt: status === 'done' ? AT : null,
    author: 'someone',
    labels: [],
    assignees: [],
    parent: null,
    blockedBy: [],
    waitingFor: [],
    status,
    nextStep: { kind: 'none' },
    isParent: false,
  }
}

function snapshot(statuses: readonly Status[], generatedAt = AT): Snapshot {
  return {
    generatedAt,
    repo: 'gunter1020/issue-map',
    labels: { ready: ['ready-for-agent'], unready: ['needs-triage'] },
    groups: [],
    criticalPath: 0,
    issues: statuses.map((status, index) => issue(index + 1, status)),
  }
}

describe('兩個數字', () => {
  /**
   * 守的是「done 的算一邊，其餘四種狀態全算另一邊」。
   *
   * 壞了會怎樣：這兩個數字對調（把條件寫反就會），每次跑完看到的就是「12 unfinished, 3 closed」
   * 而實際是反過來的。使用者判斷這次抓到什麼只有這一句話可依據，沒有別的地方對得出來。
   */
  test('done 之外的四種狀態都算 unfinished', () => {
    const line = describeSnapshot(
      snapshot(['ready', 'active', 'blocked', 'triage', 'done', 'done']),
    )

    expect(line).toBe(`4 unfinished, 2 closed but still referenced (${AT})`)
  })

  /**
   * 守的是「全部關完時 unfinished 是 0」。
   *
   * 壞了會怎樣：做完了卻還被告知有幾張沒做，或反過來。這是最該一眼看出來的那一種。
   */
  test('全部都是 done 時 unfinished 是 0', () => {
    const line = describeSnapshot(snapshot(['done', 'done', 'done']))

    expect(line).toBe(`0 unfinished, 3 closed but still referenced (${AT})`)
  })

  /**
   * 守的是「沒有 closed 票時後面那個數字是 0」。
   *
   * 壞了會怎樣：快照裡一張已完成的票都沒有（新 repo，或沒有任何 closed 票還被牽著），卻報出
   * 一個非零的張數，看的人會去找那幾張不存在的票。
   */
  test('一張 done 都沒有時 closed 是 0', () => {
    const line = describeSnapshot(snapshot(['ready', 'blocked']))

    expect(line).toBe(`2 unfinished, 0 closed but still referenced (${AT})`)
  })

  /** 空快照兩個都是 0，不是 NaN、也不是負數。 */
  test('空快照兩個都是 0', () => {
    const line = describeSnapshot(snapshot([]))

    expect(line).toBe(`0 unfinished, 0 closed but still referenced (${AT})`)
  })
})

describe('時間', () => {
  /**
   * 守的是「`generatedAt` 原字帶出來，不在這裡重新格式化」。
   *
   * 壞了會怎樣：快照裡存的是 ISO 字串，頁面那一側也是照它顯示。這裡自己轉成別種格式的話，
   * 同一份快照在 CLI 與頁面上會寫著兩個不一樣的時間。
   */
  test('generatedAt 照原字帶進輸出', () => {
    const at = '2026-09-13T07:55:24.000Z'
    const line = describeSnapshot(snapshot(['ready'], at))

    expect(line).toEndWith(`(${at})`)
  })
})
