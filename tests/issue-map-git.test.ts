import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  branchMapFor,
  issueInName,
  type LocalGit,
  readLocalBranches,
  remoteRepos,
} from '../src/issue-map-git.ts'
import { gitIn, makeClone } from './git-fixture.ts'

/**
 * 本機分支那一塊。壞掉的徵狀是「分支圖說謊」：領先落後數字反了、把別的 repo 的分支畫進來、
 * 把版本號當成票號——圖上看起來都像真的，不會有人發現。
 */

describe('remote 認得哪些 repo', () => {
  test('https、ssh、scp 寫法都收成小寫 owner/name，去重', () => {
    const output = [
      'origin\thttps://github.com/Owner/Repo.git (fetch)',
      'origin\thttps://github.com/Owner/Repo.git (push)',
      'upstream\tgit@github.com:up/stream.git (fetch)',
      'mirror\tssh://git@github.com/mir/ror.git (fetch)',
      'other\thttps://gitlab.com/x/y.git (fetch)',
    ].join('\n')
    expect(remoteRepos(output)).toEqual(['owner/repo', 'up/stream', 'mir/ror'])
  })
})

describe('分支名提到的票', () => {
  const known = new Set([12, 45])

  test('被分隔符號隔開的整段數字，而且在快照裡', () => {
    expect(issueInName('feature/12-map', known)).toBe(12)
    expect(issueInName('fix/#45', known)).toBe(45)
    expect(issueInName('gunter/fix/45', known)).toBe(45)
    expect(issueInName('issue_12', known)).toBe(12)
  })

  /** 名字裡的數字不一定是票：版本號、年份、黏在字裡的數字都不算。 */
  test('不在快照裡、或黏在字裡的數字不算', () => {
    expect(issueInName('release-2026', known)).toBeNull()
    expect(issueInName('v12', known)).toBeNull()
    expect(issueInName('feature/123-map', known)).toBeNull()
    expect(issueInName('main', known)).toBeNull()
  })
})

describe('這份 clone 能不能畫在這張圖上', () => {
  const local: LocalGit = {
    remotes: ['owner/repo'],
    base: 'main',
    hidden: 0,
    branches: [
      {
        name: 'feature/12-x',
        head: 'abc',
        committedAt: '2026-01-01T00:00:00Z',
        ahead: 1,
        behind: 0,
        current: true,
      },
    ],
  }

  /** 設了 `GH_REPO` 畫別的 repo 時，cwd 那份 clone 的分支跟這張圖無關。 */
  test('remote 對不上就不畫', () => {
    expect(branchMapFor(local, 'other/repo', new Set())).toBeNull()
    expect(branchMapFor(null, 'owner/repo', new Set())).toBeNull()
  })

  test('對得上就補票號；repo 名不分大小寫', () => {
    const map = branchMapFor(local, 'Owner/Repo', new Set([12]))
    expect(map?.branches[0]?.issue).toBe(12)
  })
})

describe('讀真的 git', () => {
  /** 領先落後是這一塊唯一的數字，左右反了整張圖就反了。 */
  test('照基準分支算領先落後，目前那一條排第一，其餘新的在前', async () => {
    const local = await readLocalBranches(await makeClone())
    expect(local?.base).toBe('main')
    expect(local?.remotes).toEqual(['owner/repo'])
    expect(
      local?.branches.map(({ name, ahead, behind, current }) => ({ name, ahead, behind, current })),
    ).toEqual([
      { name: 'feature/12-map', ahead: 2, behind: 3, current: true },
      { name: 'release-2026', ahead: 1, behind: 1, current: false },
      { name: 'old-merged', ahead: 0, behind: 2, current: false },
    ])
  })

  /** 本機沒有預設分支時跟 remote-tracking 的比，名字照實寫出來。 */
  test('origin/HEAD 指的分支本機沒有，就跟 origin 那一條比', async () => {
    const dir = await makeClone()
    gitIn(dir, 'update-ref', 'refs/remotes/origin/trunk', 'main')
    gitIn(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    gitIn(dir, 'branch', '-q', '-m', 'main', 'local-main')
    const local = await readLocalBranches(dir)
    expect(local?.base).toBe('origin/trunk')
    expect(local?.branches.find((b) => b.name === 'local-main')).toMatchObject({
      ahead: 0,
      behind: 0,
    })
  })

  test('不是 git 目錄就是 null，不是錯誤', async () => {
    expect(await readLocalBranches(await mkdtemp(join(tmpdir(), 'issue-map-plain-')))).toBeNull()
  })
})
