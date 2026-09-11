/**
 * 突變測試：改壞一行，看測試會不會紅。
 *
 * **為什麼手寫而不是用 Stryker。** Stryker 的 runner 清單是 jasmine／jest／karma／mocha／tap／
 * vitest／cucumber／command——沒有 bun。只能走 command runner，而它對**每一個 mutant 重跑全部
 * 測試**。這支限定範圍到單一檔案並只跑指定的測試檔，幾分鐘就跑完。（這支跟著開發地圖從原本
 * 的專案搬過來，那邊的規模是全套 29 秒、src 一萬行，用 Stryker 估要十幾小時。）
 *
 * 它回答兩個問題，第二個是 `--coverage` 答不出來的：
 *   1. **突變分數**——改壞了有沒有人抓到。存活的 mutant 就是覆蓋率數字騙人的地方。
 *   2. **重複度**——一行改壞紅了幾支。紅 20 支代表那 20 支在守同一件事。
 *
 * 只用**保型別**的算子（比較、布林、min/max 對調）。換掉會編譯失敗的東西沒有意義：那種 mutant
 * 一定「被殺掉」，而它殺的是編譯器不是測試。但算子保型別**不等於** mutant 保型別（見
 * `typechecks`），所以每個 mutant 都還要實際過一次 `tsc`。
 *
 * 用法：
 *   bun run scripts/mutate.ts scripts/issue-map-model.ts tests/issue-map-layout.test.ts
 *   bun run scripts/mutate.ts scripts/issue-map-model.ts   # 不給測試檔就跑全套
 */

import { spawn } from 'bun'

/** 保型別的算子。順序有意義：先比對長的（`===` 要贏過 `==`）。 */
const OPERATORS: readonly { readonly from: string; readonly to: string }[] = [
  { from: '===', to: '!==' },
  { from: '!==', to: '===' },
  { from: '>=', to: '>' },
  { from: '<=', to: '<' },
  { from: '&&', to: '||' },
  { from: '||', to: '&&' },
  { from: 'Math.min', to: 'Math.max' },
  { from: 'Math.max', to: 'Math.min' },
  { from: 'true', to: 'false' },
  { from: 'false', to: 'true' },
]

type Mutant = {
  readonly line: number
  readonly from: string
  readonly to: string
  readonly text: string
}

/**
 * 跳過註解與型別位置。
 *
 * **型別位置一定要跳。** discriminated union 的 `{ ok: false; why: … }` 把 `false` 換成 `true`
 * 只改型別不改行為，於是它必然存活——而那種誤報會蓋掉真正的存活 mutant。實測 `engine/stage.ts`
 * 第一版報 4 個存活，四個全是 union 的續行；扣掉之後突變分數從 64% 變成 100%。
 *
 * union／intersection 的續行（`|`、`&` 開頭）與型別成員（`readonly` 開頭）都算型別位置。
 * `readonly` 在 TypeScript 只出現在型別位置，所以跳它不會漏掉程式碼。
 *
 * 不做完整的 JS 剖析：字串字面值裡的 `true` 被換掉頂多多產一個必然存活的 mutant，而那是報表上
 * 看得見的雜訊，不是靜默的錯。真的要精確就得整個 parser，代價遠超過這支腳本的用途。
 */
const skippable = (line: string): boolean => {
  const t = line.trim()
  return (
    t.length === 0 ||
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('import ') ||
    t.startsWith('export type') ||
    t.startsWith('export interface') ||
    t.startsWith('type ') ||
    t.startsWith('interface ') ||
    t.startsWith('|') ||
    t.startsWith('&') ||
    t.startsWith('readonly ')
  )
}

const plan = (source: string): Mutant[] => {
  const out: Mutant[] = []
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    if (skippable(line)) continue
    for (const op of OPERATORS) {
      if (!line.includes(op.from)) continue
      // 一行一個算子只換第一次出現。同一行的第二處通常是同一個判斷的另一半
      out.push({
        line: index + 1,
        from: op.from,
        to: op.to,
        text: line.replace(op.from, op.to),
      })
    }
  }
  return out
}

/**
 * 一次測試的結果。
 *
 * `timeout` 和 `broken` 要分開：**逾時算殺掉**——把迴圈的離開條件改反，測試就跑不完，那正是
 * 測試把缺陷擋下來了（Stryker、PIT 也都這樣算）。編譯失敗或 crash 才是不計分，因為殺掉它的
 * 是編譯器不是測試。
 */
type RunResult =
  | { readonly kind: 'ran'; readonly failed: number }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'broken' }

/**
 * 型別檢查現在磁碟上的內容。編譯不過的 mutant 不計分——殺掉它的是編譯器不是測試。
 *
 * **保型別的算子不等於保型別的 mutant。** `===` → `!==` 會把 narrowing 的方向一起翻過來：
 *
 * ```ts
 * if (back === undefined) break   // 之後 back 收斂成 number
 * at = back                       // 編譯得過
 * ```
 *
 * 換成 `!==` 之後 `back` 收斂成 `undefined`，`at = back` 就是 TS2322。而 `bun test` 只剝型別、
 * 不檢查型別，這種 mutant 照樣跑得起來、測試照樣紅，於是被誤記成「測試殺掉的」，把突變分數灌水。
 * Stryker 用 typescript-checker 解同一個問題，而且同樣排在 test runner 之前。
 */
const typechecks = async (): Promise<boolean> => {
  const proc = spawn(['bunx', 'tsc', '--noEmit'], { stdout: 'pipe', stderr: 'pipe' })
  await new Response(proc.stdout).text()
  await new Response(proc.stderr).text()
  return (await proc.exited) === 0
}

/** 跑一次測試。 */
const runTests = async (targets: readonly string[], timeoutMs: number): Promise<RunResult> => {
  const proc = spawn(['bun', 'test', ...targets], { stdout: 'pipe', stderr: 'pipe' })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  try {
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())
    await proc.exited
    if (timedOut) return { kind: 'timeout' }
    const fail = /^\s*(\d+) fail/m.exec(out)
    const pass = /^\s*(\d+) pass/m.exec(out)
    // 一支都沒跑起來＝編譯失敗或 crash，那不是「測試抓到了」
    if (!pass && !fail) return { kind: 'broken' }
    return { kind: 'ran', failed: fail ? Number(fail[1]) : 0 }
  } finally {
    clearTimeout(timer)
  }
}

/** 基準沒得比，給寬一點。 */
const BASELINE_TIMEOUT_MS = 120_000
/** mutant 的逾時＝基準的幾倍。會 hang 的 mutant 是常態，等它跑完只是浪費。 */
const TIMEOUT_FACTOR = 20
/** 逾時下限。基準只有幾毫秒時不能真的照倍數算。 */
const MIN_TIMEOUT_MS = 2_000

const main = async (): Promise<number> => {
  const [target, ...testTargets] = process.argv.slice(2)
  if (target === undefined) {
    console.error('用法：bun run scripts/mutate.ts <原始碼檔> [測試檔...]')
    return 1
  }

  const file = Bun.file(target)
  if (!(await file.exists())) {
    console.error(`找不到 ${target}`)
    return 1
  }
  const original = await file.text()
  const mutants = plan(original)
  const lines = original.split('\n')

  const scope = testTargets.length > 0 ? testTargets.join(' ') : '全套'
  console.log(`${target}：${mutants.length} 個 mutant，測試範圍 ${scope}`)

  // 基準自己就編不過的話，後面每個 mutant 都會被判成「編譯不過」，報表會變成一片空白
  if (!(await typechecks())) {
    console.error('基準的 typecheck 就不過了，先跑 bun run check')
    return 1
  }

  // 先確認基準是綠的。基準就紅的話後面每個數字都沒有意義
  const started = performance.now()
  const baseline = await runTests(testTargets, BASELINE_TIMEOUT_MS)
  const baselineMs = performance.now() - started
  if (baseline.kind !== 'ran' || baseline.failed > 0) {
    const why =
      baseline.kind === 'ran' ? `紅 ${baseline.failed} 支` : `跑不起來（${baseline.kind}）`
    console.error(`基準不是綠的（${why}），先把測試修綠再量`)
    return 1
  }

  // 照基準抓逾時。固定 120 秒的話，一個無窮迴圈的 mutant 就能讓整輪從一秒變一分鐘
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.ceil(baselineMs * TIMEOUT_FACTOR))

  const survivors: Mutant[] = []
  const killCounts: { readonly mutant: Mutant; readonly failed: number }[] = []
  let timeouts = 0
  let broken = 0

  try {
    for (const [index, mutant] of mutants.entries()) {
      const patched = [...lines]
      patched[mutant.line - 1] = mutant.text
      await Bun.write(target, patched.join('\n'))

      // 型別檢查排在測試之前：編譯不過的 mutant 不必也不該跑
      const result: RunResult = (await typechecks())
        ? await runTests(testTargets, timeoutMs)
        : { kind: 'broken' }
      const mark =
        result.kind === 'broken'
          ? '·'
          : result.kind === 'timeout'
            ? '⏱'
            : result.failed === 0
              ? '✗'
              : '✓'
      process.stdout.write(
        `\r[${index + 1}/${mutants.length}] ${mark} ${mutant.line}: ${mutant.from}→${mutant.to}      `,
      )

      if (result.kind === 'broken') broken += 1
      else if (result.kind === 'timeout') timeouts += 1
      else if (result.failed === 0) survivors.push(mutant)
      else killCounts.push({ mutant, failed: result.failed })
    }
  } finally {
    // **一定要還原。** 中途 Ctrl+C 留下一個改壞的檔案比沒有這支腳本糟得多
    await Bun.write(target, original)
  }

  const killed = killCounts.length + timeouts
  const scored = survivors.length + killed
  console.log(`\n\n── 突變分數 ──`)
  console.log(
    `殺掉 ${killed}／${scored}` +
      (scored > 0 ? `　${Math.round((killed / scored) * 100)}%` : '') +
      (timeouts > 0 ? `　（含 ${timeouts} 個逾時，逾時算殺掉）` : '') +
      (broken > 0 ? `　（另有 ${broken} 個跑不起來，不計入）` : ''),
  )

  if (survivors.length > 0) {
    console.log(`\n── 存活的 mutant：改壞了沒人抓到 ──`)
    for (const m of survivors) {
      console.log(`  ${target}:${m.line}　${m.from} → ${m.to}`)
      console.log(`    ${lines[m.line - 1]?.trim().slice(0, 100) ?? ''}`)
    }
  }

  if (killCounts.length > 0) {
    const sorted = [...killCounts].sort((a, b) => b.failed - a.failed)
    const avg = killCounts.reduce((sum, k) => sum + k.failed, 0) / killCounts.length
    console.log(`\n── 重複度：一個 mutant 平均紅 ${avg.toFixed(1)} 支 ──`)
    console.log('紅最多的前五個（數字大＝多支測試在守同一件事）：')
    for (const k of sorted.slice(0, 5)) {
      console.log(
        `  紅 ${k.failed} 支　${target}:${k.mutant.line}　${k.mutant.from} → ${k.mutant.to}`,
      )
    }
  }

  return survivors.length > 0 ? 1 : 0
}

process.exit(await main())
