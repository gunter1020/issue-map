import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseRepo, RecentRepos } from '../app/repos.ts'

/**
 * app 沒有 cwd 可推 repo，畫哪個 repo 全看這裡收斂出來的 `owner/name`——收錯了 gh 會去畫
 * 另一個 repo，或拿到一段看不懂的錯誤。
 */

describe('輸入收斂成 owner/name', () => {
  /** 直接打的與從瀏覽器網址列貼來的，都要收成同一個。 */
  test('owner/name、網址、帶後綴的網址、git 網址都認得', () => {
    expect(parseRepo('cli/cli')).toBe('cli/cli')
    expect(parseRepo('  cli/cli  ')).toBe('cli/cli')
    expect(parseRepo('https://github.com/oven-sh/bun')).toBe('oven-sh/bun')
    expect(parseRepo('github.com/oven-sh/bun/issues/42')).toBe('oven-sh/bun')
    expect(parseRepo('https://github.com/oven-sh/bun.git')).toBe('oven-sh/bun')
    expect(parseRepo('git@github.com:oven-sh/bun.git')).toBe('oven-sh/bun')
  })

  /** 認不出來就說認不出來，不把怪字串交給 gh。 */
  test('缺一半、非法字元、路徑名都拒絕', () => {
    expect(parseRepo('')).toBeNull()
    expect(parseRepo('cli')).toBeNull()
    expect(parseRepo('cli/')).toBeNull()
    expect(parseRepo('-cli/cli')).toBeNull()
    expect(parseRepo('cli/c li')).toBeNull()
    expect(parseRepo('cli/..')).toBeNull()
    expect(parseRepo('https://gitlab.com/a/b')).toBeNull()
  })
})

describe('最近開過的 repo', () => {
  async function fresh() {
    return mkdtemp(join(tmpdir(), 'issue-map-recent-'))
  }

  /** 沒開過任何 repo 是常態，不是錯誤。 */
  test('檔案不存在就是空清單', async () => {
    expect(await new RecentRepos(await fresh()).list()).toEqual([])
  })

  /** 再開一次舊的就移到最前面，不重複出現。 */
  test('新的在前、不重複', async () => {
    const recent = new RecentRepos(await fresh())
    await recent.add('a/one')
    await recent.add('b/two')
    await recent.add('a/one')
    expect(await recent.list()).toEqual(['a/one', 'b/two'])
  })

  /** 清單只是捷徑，壞掉了重來就好，不能讓首頁開不起來。 */
  test('壞掉的檔案當成空清單，之後照常寫入', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'recent.json'), '{not json')
    const recent = new RecentRepos(dir)
    expect(await recent.list()).toEqual([])
    await recent.add('a/one')
    expect(JSON.parse(await readFile(join(dir, 'recent.json'), 'utf8'))).toEqual(['a/one'])
  })

  /** 手改過的檔案裡不像 repo 的項目不能變成首頁上的連結。 */
  test('過濾掉不像 repo 的項目', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'recent.json'), JSON.stringify(['a/one', 42, 'nope', '../x']))
    expect(await new RecentRepos(dir).list()).toEqual(['a/one'])
  })
})
