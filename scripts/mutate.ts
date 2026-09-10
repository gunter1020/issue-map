/**
 * 突變測試：改壞一行，看測試會不會紅。
 *
 * **為什麼手寫而不是用 Stryker。** Stryker 的 runner 清單是 jasmine／jest／karma／mocha／tap／
 * vitest／cucumber／command——沒有 bun。只能走 command runner，而它對**每一個 mutant 重跑全部
 * 測試**。這支限定範圍到單一檔案並只跑指定的測試檔，幾分鐘就跑完。（這支跟著開發地圖從
 * trpg-keeper 搬過來，那邊的規模是全套 29 秒、src 一萬行，用 Stryker 估要十幾小時。）
 *
 * 它回答兩個問題，第二個是 `--coverage` 答不出來的：
 *   1. **突變分數**——改壞了有沒有人抓到。存活的 mutant 就是覆蓋率數字騙人的地方。
 *   2. **重複度**——一行改壞紅了幾支。紅 20 支代表那 20 支在守同一件事。
 *
 * 只用**保型別**的算子（比較、布林、min/max 對調）。換掉會編譯失敗的東西沒有意義：那種 mutant
 * 一定「被殺掉」，而它殺的是編譯器不是測試。
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

/** 跑一次測試，回「紅了幾支」。`null` 代表跑不起來（編譯失敗或逾時），不計入分數。 */
const runTests = async (targets: readonly string[], timeoutMs: number): Promise<number | null> => {
  const proc = spawn(['bun', 'test', ...targets], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => {
    proc.kill()
  }, timeoutMs)
  try {
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())
    await proc.exited
    const fail = /^\s*(\d+) fail/m.exec(out)
    const pass = /^\s*(\d+) pass/m.exec(out)
    // 一支都沒跑起來＝編譯失敗或 crash，那不是「測試抓到了」
    if (!pass && !fail) return null
    return fail ? Number(fail[1]) : 0
  } finally {
    clearTimeout(timer)
  }
}

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

  // 先確認基準是綠的。基準就紅的話後面每個數字都沒有意義
  const baseline = await runTests(testTargets, 120_000)
  if (baseline === null || baseline > 0) {
    console.error(`基準不是綠的（紅 ${baseline ?? '跑不起來'}），先把測試修綠再量`)
    return 1
  }

  const survivors: Mutant[] = []
  const killCounts: { readonly mutant: Mutant; readonly failed: number }[] = []
  let broken = 0

  try {
    for (const [index, mutant] of mutants.entries()) {
      const patched = [...lines]
      patched[mutant.line - 1] = mutant.text
      await Bun.write(target, patched.join('\n'))

      const failed = await runTests(testTargets, 120_000)
      const mark = failed === null ? '·' : failed === 0 ? '✗' : '✓'
      process.stdout.write(
        `\r[${index + 1}/${mutants.length}] ${mark} ${mutant.line}: ${mutant.from}→${mutant.to}      `,
      )

      if (failed === null) broken += 1
      else if (failed === 0) survivors.push(mutant)
      else killCounts.push({ mutant, failed })
    }
  } finally {
    // **一定要還原。** 中途 Ctrl+C 留下一個改壞的檔案比沒有這支腳本糟得多
    await Bun.write(target, original)
  }

  const scored = survivors.length + killCounts.length
  console.log(`\n\n── 突變分數 ──`)
  console.log(
    `殺掉 ${killCounts.length}／${scored}` +
      (scored > 0 ? `　${Math.round((killCounts.length / scored) * 100)}%` : '') +
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
