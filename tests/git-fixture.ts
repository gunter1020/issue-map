import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 測試用的本機 clone。用真的 git 建，讀分支那一段才測得到 git 實際的輸出格式。
 *
 * 不吃使用者的 git 設定（簽章、預設分支名、hook 都可能讓 commit 失敗或長得不一樣），commit 時間
 * 照順序遞增，分支的新舊排序才是固定的。
 */

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
}

export function gitIn(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], { env: ENV, stderr: 'pipe' })
  if (!result.success) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

/**
 * 建一份 clone：
 *
 *   main:            m1 ─ m2 ─ m3 ─ m4
 *   feature/12-map:   └─ f1 ─ f2            （從 m1 岔出：領先 2、落後 3，目前 checkout）
 *   old-merged:            m2               （停在 m2：領先 0、落後 2）
 *   release-2026:               └─ r1       （從 m3 岔出：領先 1、落後 1）
 */
export async function makeClone(remote = 'https://github.com/owner/repo.git'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'issue-map-git-'))
  let clock = 1_700_000_000
  const commit = (name: string) => {
    clock += 60
    const date = `@${clock} +0000`
    writeFileSync(join(dir, `${name}.txt`), `${name}\n`)
    gitIn(dir, 'add', '.')
    const result = Bun.spawnSync(['git', '-C', dir, 'commit', '-q', '-m', name], {
      env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stderr: 'pipe',
    })
    if (!result.success) throw new Error(result.stderr.toString())
  }

  gitIn(dir, 'init', '-q', '-b', 'main')
  gitIn(dir, 'remote', 'add', 'origin', remote)
  commit('m1')
  gitIn(dir, 'branch', 'feature/12-map')
  commit('m2')
  gitIn(dir, 'branch', 'old-merged')
  commit('m3')
  gitIn(dir, 'branch', 'release-2026')
  commit('m4')
  gitIn(dir, 'checkout', '-q', 'release-2026')
  commit('r1')
  gitIn(dir, 'checkout', '-q', 'feature/12-map')
  commit('f1')
  commit('f2')
  return dir
}
