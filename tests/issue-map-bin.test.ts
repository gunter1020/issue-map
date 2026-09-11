import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

import packageJson from '../package.json' with { type: 'json' }

/**
 * 兩支 bin wrapper 的行為。npm 發的是 TypeScript 原始碼，bin 走 node，所以「node 拿到這支檔案
 * 會發生什麼事」是對外契約的一部分——這裡全部用真的子行程驗，不 mock。
 *
 * 假的 `bun` 用 `/bin/sh` 腳本做，所以這一檔是 POSIX-only；CI 跑 ubuntu，開發機是 macOS。
 */

const ROOT = resolve(import.meta.dir, '..')
const SERVE_BIN = join(ROOT, 'scripts/issue-map-serve-bin.mjs')
const BUILD_BIN = join(ROOT, 'scripts/issue-map-build-bin.mjs')

/**
 * node 用絕對路徑呼叫，PATH 才能乾淨到「一定沒有 bun」。`process.execPath` 在 `bun test` 底下是
 * bun 自己，不能拿來找 node。
 */
const NODE = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim()

/** 系統工具的最小 PATH：有 `sh`、`env` 之類，但一定沒有 `bun`。 */
const PATH_WITHOUT_BUN = '/usr/bin:/bin'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** 造一個放了假 `bun` 的目錄。`path` 是把它接在系統 PATH 前面的結果。 */
function fakeBun(script: (dir: string) => string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'issue-map-bin-'))
  tempDirs.push(dir)
  const bun = join(dir, 'bun')
  writeFileSync(bun, script(dir))
  chmodSync(bun, 0o755)
  return { dir, path: `${dir}:${PATH_WITHOUT_BUN}` }
}

/** node 的絕對路徑。這一檔驗的就是 node 進入點，沒有 node 就沒有可驗的東西。 */
function nodeOrFail(): string {
  if (!NODE) throw new Error('PATH 上找不到 node，這一檔驗的就是 node 進入點，無從驗起')
  return NODE
}

/** 行程還在不在。`signal 0` 只做存在性檢查，不送訊號。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 撐到條件成立為止，超過 `timeout` 就放棄，讓斷言去報告實際狀態。 */
async function waitFor(condition: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!condition() && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 20))
  }
}

/** 用 node 跑 wrapper 到結束。`path` 就是子行程看得到的整個 PATH。 */
function runBin(bin: string, args: string[], path: string) {
  return spawnSync(nodeOrFail(), [bin, ...args], { encoding: 'utf8', env: { PATH: path } })
}

describe('找不到 bun', () => {
  /**
   * 守的是「沒裝 bun 的人看得懂發生什麼事」，也就是 #15 的本體；為什麼原本的訊息會長那樣，見
   * `scripts/issue-map-bin.mjs` 的檔頭。
   *
   * 壞了會怎樣：使用者拿回 shell 或 node 層的原始錯誤，看得到 bun 這個字，但不知道要裝它，也
   * 不知道下一步。npm 的套件頁面同樣看不出來。
   */
  test('印出要裝 bun 的訊息並以 1 結束', () => {
    const result = runBin(SERVE_BIN, [], PATH_WITHOUT_BUN)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Bun')
    expect(result.stderr).toContain('bunx issue-map')
    expect(result.stderr).toContain('https://bun.sh')
  })

  /**
   * 守的是「不要把 runtime 的內部錯誤轉述給使用者」。
   *
   * 壞了會怎樣：wrapper 如果只是把 spawn 的 error 丟出去，使用者會看到 node 的 stack trace 或
   * `ERR_MODULE_NOT_FOUND`，那正是原本就看不懂的那種訊息——換了一層包裝但沒解決問題。
   */
  test('訊息裡沒有 node 的內部錯誤字串', () => {
    const result = runBin(SERVE_BIN, [], PATH_WITHOUT_BUN)

    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(result.stderr).not.toContain('No such file or directory')
    expect(result.stderr).not.toContain('at Object.')
  })

  test('build 入口也是同一套訊息', () => {
    const result = runBin(BUILD_BIN, [], PATH_WITHOUT_BUN)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bunx issue-map')
  })

  /**
   * 守的是「不只是沒裝，啟動不了也要講人話」。
   *
   * 壞了會怎樣：PATH 上有個叫 bun 但不能執行的檔案（權限不對、被 shim 佔名）時，只處理 ENOENT
   * 的話例外會從事件回呼跑掉，使用者拿到的又是 stack trace。
   */
  test('bun 存在但不能執行時，仍是一句話而不是 stack trace', () => {
    const { dir, path } = fakeBun(() => '#!/bin/sh\nexit 0\n')
    chmodSync(join(dir, 'bun'), 0o644)
    const result = runBin(SERVE_BIN, [], path)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('issue-map')
    expect(result.stderr).not.toContain('at ChildProcess')
  })
})

describe('找得到 bun', () => {
  /** 假 bun：把拿到的參數一行一個印出來。 */
  const echoArgs = () => '#!/bin/sh\nprintf "%s\\n" "$@"\n'

  /**
   * 守的是「wrapper 不改變使用者下的指令」。
   *
   * 壞了會怎樣：參數掉了或順序變了，`issue-map-build out.html` 會寫到預設路徑而不是指定的
   * 路徑，而使用者看到的是「指令成功但檔案不在那裡」——比直接失敗更難查。
   */
  test('把使用者參數原樣接在腳本後面轉給 bun', () => {
    const result = runBin(BUILD_BIN, ['out.html', '--flag'], fakeBun(echoArgs).path)
    const lines = result.stdout.trim().split('\n')

    expect(result.status).toBe(0)
    expect(lines[0]).toBe('run')
    expect(lines[1]).toEndWith('/scripts/issue-map.ts')
    expect(lines.slice(2)).toEqual(['out.html', '--flag'])
  })

  test('serve 入口轉給 bun 的是 server 那一支', () => {
    const result = runBin(SERVE_BIN, [], fakeBun(echoArgs).path)

    expect(result.stdout.trim().split('\n')[1]).toEndWith('/scripts/issue-map-serve.ts')
  })

  /**
   * 守的是「離開碼是 bun 的離開碼」。
   *
   * 壞了會怎樣：wrapper 永遠回 0 的話，CI 或 shell 的 `&&` 串接會把失敗當成功——產圖失敗卻繼
   * 續往下跑，錯誤要到很後面才浮出來。
   */
  test('bun 的離開碼原樣透傳', () => {
    const result = runBin(BUILD_BIN, [], fakeBun(() => '#!/bin/sh\nexit 42\n').path)

    expect(result.status).toBe(42)
  })

  /**
   * 守的是「收掉 wrapper 就等於收掉 bun」。
   *
   * 壞了會怎樣：實際踩到過——wrapper 用 spawnSync 時，訊號送給 wrapper 那個 pid，node 死了但
   * 卡在同步等待裡的 bun 收不到，於是 server 變成 PPID 1 的孤兒繼續占著 port。使用者下次再起
   * 一次就撞 port（`ISSUE_MAP_PORT` 指定時是直接失敗），而且看不到是誰占的。
   */
  test('收掉 wrapper 時 bun 一起收掉，不留孤兒', async () => {
    const pidPath = (dir: string) => join(dir, 'bun.pid')
    const { dir, path } = fakeBun((d) => `#!/bin/sh\necho $$ > "${pidPath(d)}"\nsleep 30\n`)
    const wrapper = spawn(nodeOrFail(), [SERVE_BIN], { env: { PATH: path }, stdio: 'ignore' })

    await waitFor(() => existsSync(pidPath(dir)))
    const bunPid = Number(readFileSync(pidPath(dir), 'utf8').trim())
    expect(alive(bunPid)).toBe(true)

    wrapper.kill('SIGTERM')
    await waitFor(() => !alive(bunPid))

    expect(alive(bunPid)).toBe(false)
  })
})

describe('套件 manifest', () => {
  /** 從 bin 出發，把相對 import 一路走完，回傳所有碰到的檔案（相對 repo 根目錄）。 */
  function reachableFrom(entries: string[]): Set<string> {
    const seen = new Set<string>()
    const queue = [...entries]

    while (queue.length > 0) {
      const file = queue.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)

      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const [, specifier] of source.matchAll(/from '(\.[^']+)'/g)) {
        if (specifier !== undefined) queue.push(join(dirname(file), specifier))
      }
    }
    return seen
  }

  /**
   * 守的是「bin 指到的東西真的會被發出去」。
   *
   * 壞了會怎樣：#19 踩過一次——`scripts/issue-map-view.ts` 沒進 `files`，本機測全綠，發到 npm
   * 上才缺檔。所以這裡不是列舉已知的檔名，而是從 bin 把 import 走完再比對：wrapper 之後多依賴
   * 一個檔而忘了列，這支測試要當場紅。
   */
  test('bin 與它走得到的檔案都存在，也都在 files 裡', () => {
    const bins = Object.values(packageJson.bin).map((target) => target.replace(/^\.\//, ''))
    const files = new Set<string>(packageJson.files)

    expect(bins.length).toBeGreaterThan(0)
    for (const file of reachableFrom(bins)) {
      expect(existsSync(join(ROOT, file))).toBe(true)
      expect(files).toContain(file)
    }
  })

  /**
   * 守的是「wrapper 跑得起來就只靠 node 內建模組」。
   *
   * 壞了會怎樣：wrapper 的唯一任務是在「還沒確定環境有什麼」的時候給出一句話。加了 runtime
   * 相依就多一層可能裝不起來的東西，而它壞掉時使用者拿到的又是看不懂的訊息。
   */
  test('沒有 runtime 相依', () => {
    expect(packageJson).not.toHaveProperty('dependencies')
  })
})
