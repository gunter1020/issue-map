import { describe, expect, test } from 'bun:test'

import { aliasedQuery, chunks, collect, type Page } from '../src/issue-map.ts'

/**
 * 查詢怎麼組、分頁怎麼翻。
 *
 * 真的送出去要打 GitHub，但**組出來的字串**與**翻頁的終止條件**都是純推導——這兩件事壞掉的
 * 徵狀都是「少了一批票」，而那在圖上看起來只像資料本來就這樣，不會有人發現。
 */

describe('批次切分', () => {
  /** 整除與不整除都要切對，最後一批是餘數。 */
  test('照大小切，最後一批放得下就好', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  /** 沒有東西要問就一批都不送。 */
  test('空的就沒有批次', () => {
    expect(chunks([], 50)).toEqual([])
  })
})

describe('alias 查詢', () => {
  /**
   * 守的是「每個票號都有自己的 alias，而且 alias 不以數字開頭」。
   *
   * 壞了會怎樣：GraphQL 的 alias 不能以數字開頭，整個查詢會被拒；兩個票號撞到同一個 alias 的話
   * 則是安靜地少回一張票。
   */
  test('每個票號一個 i 開頭的 alias', () => {
    const query = aliasedQuery([7, 12], 'number state')

    expect(query).toContain('i7: issue(number: 7) { number state }')
    expect(query).toContain('i12: issue(number: 12) { number state }')
    expect(query).not.toMatch(/\n\s*7: issue/)
  })

  /** 要選什麼欄位由呼叫端決定——完整欄位與只問狀態走的是同一支。 */
  test('selection 原樣帶進去', () => {
    expect(aliasedQuery([1], 'subIssues(first: 100) { nodes { number } }')).toContain(
      'i1: issue(number: 1) { subIssues(first: 100) { nodes { number } } }',
    )
  })
})

describe('翻頁', () => {
  const page = <T>(nodes: T[], endCursor: string | null): Page<T> => ({
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    nodes,
  })

  /**
   * 守的是「一路翻到最後一頁」。
   *
   * 壞了會怎樣：只拿第一頁的話，票超過 100 張的 repo 會安靜地少掉後面全部——圖上看起來就像那些
   * 票不存在。
   */
  test('照 cursor 一路翻到底', async () => {
    const seen: (string | null)[] = []
    const pages = [page([1, 2], 'c1'), page([3], 'c2'), page([4], null)]
    const all = await collect<number>(async (after) => {
      seen.push(after)
      return pages[seen.length - 1] ?? null
    })

    expect(all).toEqual([1, 2, 3, 4])
    expect(seen).toEqual([null, 'c1', 'c2'])
  })

  /**
   * 守的是「說還有下一頁卻沒給 cursor 就停」。
   *
   * 壞了會怎樣：拿 null 當 cursor 再要一次，回來的是同一頁，於是永遠翻不完。
   */
  test('沒有 cursor 就停，不會原地打轉', async () => {
    let calls = 0
    const all = await collect<number>(async () => {
      calls += 1
      return { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [1] }
    })

    expect(all).toEqual([1])
    expect(calls).toBe(1)
  })

  /** 那個東西不存在（票號查不到）就當沒有，不是錯誤。 */
  test('回 null 就當沒有', async () => {
    expect(await collect<number>(async () => null)).toEqual([])
  })

  /**
   * 守的是「續抓要從上一頁的尾巴接下去」。
   *
   * 壞了會怎樣：從頭要一次的話，第一頁會被重複收進來，那張票在圖上就變成兩份。
   */
  test('給了起點就從那裡接下去', async () => {
    const seen: (string | null)[] = []
    const all = await collect<number>(async (after) => {
      seen.push(after)
      return page([9], null)
    }, 'from-here')

    expect(all).toEqual([9])
    expect(seen).toEqual(['from-here'])
  })
})
