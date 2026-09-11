import { describe, expect, test } from 'bun:test'

import { dataOrThrow } from '../scripts/issue-map.ts'

/**
 * `gh api graphql` 的輸出怎麼判讀。抓取本身要真的打 GitHub，這裡只驗判讀那一段。
 */

describe('查不到的票', () => {
  /**
   * 守的是「一個票號查不到，不會讓整張圖產不出來」。
   *
   * 壞了會怎樣：實際踩到過——`grafana/grafana` 的某張票指向 #500，那個號碼在該 repo 解析不到
   * （可能是 PR、被轉移、被刪掉，或內文 `## Parent` 慣例掃出來的誤判）。GitHub 會同時回 data
   * （那個 alias 是 null）與一筆 NOT_FOUND，而 `gh` 為了那筆錯誤以非零離開。把它當成致命錯誤
   * 的話，整個 repo 就畫不出地圖——而那種票號在老 repo 上是常態。
   */
  test('NOT_FOUND 不算錯誤，資料照用', () => {
    const stdout = JSON.stringify({
      data: { repository: { i500: null, i1: { number: 1 } } },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repository', 'i500'],
          message: 'Could not resolve to an Issue with the number of 500.',
        },
      ],
    })
    const data = dataOrThrow<{ repository: { i500: null; i1: { number: number } } }>(
      stdout,
      'gh: Could not resolve to an Issue with the number of 500.',
    )

    expect(data.repository.i500).toBeNull()
    expect(data.repository.i1.number).toBe(1)
  })

  /**
   * 守的是「NOT_FOUND 以外的錯誤還是要拋」。
   *
   * 壞了會怎樣：權限不足、查詢寫錯、被限流——這些繼續跑下去只會畫出一張缺了一半的圖，而看的人
   * 不知道缺了什麼。
   */
  test('其他型別的錯誤照樣拋', () => {
    const stdout = JSON.stringify({
      data: { repository: null },
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
    })
    expect(() => dataOrThrow(stdout, '')).toThrow(/FORBIDDEN/)
  })

  /** 混著兩種錯誤時，以致命的那個為準。 */
  test('同時有 NOT_FOUND 與其他錯誤時仍然拋', () => {
    const stdout = JSON.stringify({
      data: { repository: {} },
      errors: [{ type: 'NOT_FOUND' }, { type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
    })
    expect(() => dataOrThrow(stdout, '')).toThrow(/RATE_LIMITED/)
  })
})

describe('連資料都沒有', () => {
  /**
   * 守的是「`gh` 完全失敗時，錯誤訊息帶得出原因」。
   *
   * 壞了會怎樣：沒登入是最常見的失敗，而那時 stdout 是空的。訊息裡沒有 stderr 的話，使用者只會
   * 看到一句沒有內容的失敗。
   */
  test('stdout 是空的時候用 stderr 當原因', () => {
    expect(() =>
      dataOrThrow('', 'gh: To get started with GitHub CLI, please run: gh auth login'),
    ).toThrow(/gh auth login/)
  })

  /** 回的不是 JSON 也一樣要拋，不能當成空資料繼續跑。 */
  test('輸出不是 JSON 時拋出', () => {
    expect(() => dataOrThrow('<html>502 Bad Gateway</html>', '')).toThrow(/502/)
  })

  /** 有 errors 但沒有 data 也要拋。 */
  test('只有 errors 沒有 data 時拋出', () => {
    const stdout = JSON.stringify({ errors: [{ type: 'NOT_FOUND' }] })
    expect(() => dataOrThrow(stdout, 'nothing resolved')).toThrow(/nothing resolved/)
  })
})
