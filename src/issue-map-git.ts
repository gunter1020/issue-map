/**
 * 本機 git 這一側：認得 GitHub repo 的寫法，讀出本機分支相對於預設分支的處境。
 *
 * 讀 git 與推導分開：`readLocalBranches` 只跑 git 收事實，`branchMapFor` 是純函式，決定這份
 * clone 算不算這個 repo、分支名提到的是哪張票——規則都測得到，不必真的有一個 repo。
 */

import { spawn } from 'bun'

import type { BranchMap, LocalBranch } from './issue-map-model.ts'

/** GitHub 的帳號名：英數與連字號，不能以連字號開頭，最長 39。 */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
/** repo 名：英數、`.`、`_`、`-`，但 `.` 與 `..` 是路徑而不是名字。 */
const NAME = /^[A-Za-z0-9._-]{1,100}$/

/**
 * 把 GitHub repo 的各種寫法收斂成 `owner/name`：直接打的、瀏覽器網址（含 `/issues` 這類後綴）、
 * git remote 的 https／ssh 網址。認不出來就回 `null`。
 */
export function parseRepo(input: string): string | null {
  const path = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/^ssh:\/\/git@github\.com(?::\d+)?\//i, '')
    .replace(/^git@github\.com:/i, '')
  const [owner, rawName] = path.split('/')
  const name = rawName?.replace(/\.git$/i, '')
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name)) return null
  if (name === '.' || name === '..') return null
  return `${owner}/${name}`
}

/** `git remote -v` 的輸出裡指向 GitHub 的那些 repo，小寫——GitHub 的名字不分大小寫。 */
export function remoteRepos(remoteVerbose: string): string[] {
  const repos = remoteVerbose
    .split('\n')
    .map((line) => line.split(/\s+/)[1] ?? '')
    .map(parseRepo)
    .filter((repo): repo is string => repo !== null)
    .map((repo) => repo.toLowerCase())
  return [...new Set(repos)]
}

/**
 * 這份 clone 代表哪個 GitHub repo：`origin` 指向 GitHub 就是它；沒有的話，指向 GitHub 的 remote
 * 只有一個 repo 才算。fork 常見的 `origin`＋`upstream` 取 `origin`——那是自己推的地方，本機分支
 * 也是對著它開的。認不出來就回 `null`，讓人自己填。
 */
export function defaultRepo(remoteVerbose: string): string | null {
  const byRemote = new Map<string, string>()
  for (const line of remoteVerbose.split('\n')) {
    const [name, url] = line.split(/\s+/)
    const repo = url ? parseRepo(url) : null
    if (name && repo && !byRemote.has(name)) byRemote.set(name, repo)
  }
  const origin = byRemote.get('origin')
  if (origin) return origin
  const distinct = new Map([...byRemote.values()].map((repo) => [repo.toLowerCase(), repo]))
  return distinct.size === 1 ? ([...distinct.values()][0] ?? null) : null
}

/**
 * 分支名提到哪張票。名字裡被 `/`、`-`、`_`、`#` 隔開的整段數字才算，而且要在 `known` 裡——
 * `release-2026`、`v2` 這種數字不在快照的票號裡，不會被當成票。
 */
export function issueInName(name: string, known: ReadonlySet<number>): number | null {
  for (const match of name.matchAll(/(?:^|[/_#-])(\d+)(?=$|[/_-])/g)) {
    const number = Number(match[1])
    if (known.has(number)) return number
  }
  return null
}

/** 列幾條。分支再多就是雜訊，最近動過的排前面，其餘只報數量。 */
export const MAX_BRANCHES = 30

/** 從一份 clone 讀回來的事實，還沒判斷它是不是要畫的那個 repo。 */
export type LocalGit = {
  /** 這份 clone 的 remote 指向哪些 GitHub repo（小寫）。 */
  readonly remotes: readonly string[]
  readonly base: string
  readonly branches: readonly Omit<LocalBranch, 'issue'>[]
  readonly hidden: number
}

/**
 * 這份 clone 的分支能不能畫在 `repo` 的地圖上，能的話補上票號。**純推導。**
 *
 * remote 對不上就不畫：設了 `GH_REPO` 畫別的 repo 時，cwd 那份 clone 的分支跟這張圖無關。
 */
export function branchMapFor(
  local: LocalGit | null,
  repo: string,
  issueNumbers: ReadonlySet<number>,
): BranchMap | null {
  if (!local || !local.remotes.includes(repo.toLowerCase())) return null
  return {
    base: local.base,
    hidden: local.hidden,
    branches: local.branches.map((branch) => ({
      ...branch,
      issue: issueInName(branch.name, issueNumbers),
    })),
  }
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const proc = spawn(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`)
  return stdout
}

/** `dir` 是不是在某個 git 工作目錄裡。不是的話不算錯：CLI 常在不是 clone 的地方設 `GH_REPO` 跑。 */
export async function isGitDir(dir: string): Promise<boolean> {
  return git(dir, 'rev-parse', '--git-dir').then(
    () => true,
    () => false,
  )
}

/** `dir` 這份 clone 的 remote 指向哪些 GitHub repo（小寫）；不是 git 目錄就是 `null`。 */
export async function remotesAt(dir: string): Promise<string | null> {
  if (!(await isGitDir(dir))) return null
  return git(dir, 'remote', '-v')
}

/** 欄位分隔：格式字串裡寫 `%00`，git 在輸出裡換成 NUL——分支名不可能含 NUL，參數裡也不能直接放。 */
const SEP = '\u0000'

/**
 * 讀出 `dir` 這份 clone 的本機分支。不是 git 目錄、或找不到預設分支就回 `null`。
 *
 * 基準分支是 `origin/HEAD` 指的那一條；本機有同名分支就跟本機的比（看的是本機），沒有才跟
 * remote-tracking 的比。都沒有就試 `main`、`master`。
 */
export async function readLocalBranches(dir: string): Promise<LocalGit | null> {
  if (!(await isGitDir(dir))) return null

  const [remotes, originHead, refs] = await Promise.all([
    git(dir, 'remote', '-v'),
    git(dir, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD').catch(() => ''),
    git(
      dir,
      'for-each-ref',
      'refs/heads',
      '--format=%(refname)%00%(objectname:short)%00%(committerdate:iso-strict)%00%(HEAD)',
    ),
  ])

  const all = refs
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', head = '', committedAt = '', star = ''] = line.split(SEP)
      return {
        ref,
        name: ref.replace(/^refs\/heads\//, ''),
        head,
        committedAt,
        current: star === '*',
      }
    })
  const names = new Set(all.map((branch) => branch.name))

  const remoteDefault = originHead.trim()
  const defaultName = remoteDefault.replace(/^origin\//, '')
  const localBase = [defaultName, 'main', 'master'].find((name) => name && names.has(name))
  const base = localBase ?? (remoteDefault || null)
  if (!base) return null
  const baseRef = localBase ? `refs/heads/${localBase}` : `refs/remotes/${remoteDefault}`

  const others = all
    .filter((branch) => branch.name !== localBase)
    // iso-strict 帶的是 commit 當下的時區，字串直接比會被時區打亂，換成時間再比。
    .toSorted(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Date.parse(b.committedAt) - Date.parse(a.committedAt),
    )
  const shown = others.slice(0, MAX_BRANCHES)

  const branches = await Promise.all(
    shown.map(async ({ ref, ...branch }) => {
      // 左邊是基準分支獨有的（落後），右邊是這一條獨有的（領先）。
      const counts = await git(dir, 'rev-list', '--left-right', '--count', `${baseRef}...${ref}`)
      const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map(Number)
      return { ...branch, ahead, behind }
    }),
  )

  return {
    remotes: remoteRepos(remotes),
    base,
    branches,
    hidden: others.length - shown.length,
  }
}
