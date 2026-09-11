/**
 * 兩支 bin 的共用進入點。npm 發的是 TypeScript 原始碼，靠 bun 直接跑，但 `npx issue-map` 是多數
 * 人的第一反應——npm 在 POSIX 把 bin 做成 symlink，執行走 shebang，所以 bin 直接指向 `.ts` 時，
 * 沒裝 bun 的人拿到的是 shell 層的 `env: bun: No such file or directory`：訊息裡有 bun 這個字，
 * 但沒說這個工具需要它，也沒有下一步。
 *
 * 因此 bin 改由 node 進入，這裡只做一件事：把工作轉給 bun，轉不過去就說清楚為什麼。
 *
 * 只用 node 內建模組，也不做版本檢查——這支的存在意義是「環境還不確定有什麼」的時候還能講出
 * 一句話，多一層相依就多一個它自己跑不起來的理由。
 */

import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MISSING_BUN = `issue-map runs on Bun, but no "bun" was found on PATH.

Install Bun from https://bun.sh, then run:

  bunx issue-map@latest`

/** 要轉給 bun 的訊號。server 是長命的，收掉 wrapper 必須等於收掉 bun。 */
const FORWARDED = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])

/**
 * 用 bun 跑同目錄下的腳本，參數、stdio 與離開碼都原樣透傳。
 *
 * @param {string} script 同目錄下的腳本檔名，例如 `issue-map-serve.ts`
 */
export function runWithBun(script) {
  const target = join(dirname(fileURLToPath(import.meta.url)), script)
  const child = spawn('bun', ['run', target, ...process.argv.slice(2)], { stdio: 'inherit' })

  // 非同步的 spawn 是必要的，不是風格選擇：spawnSync 會把事件迴圈鎖住，訊號要等子行程結束才輪
  // 得到處理——node 先被收掉，卡在等待裡的 bun 反而變成 PPID 1 的孤兒繼續占著 port。
  //
  // 自己掛了 handler 之後 node 不再因為 SIGINT 自動結束，離開時機改由下面的 exit 決定。
  for (const signal of FORWARDED) {
    process.on(signal, () => {
      child.kill(signal)
    })
  }

  // ENOENT 就是「沒裝 bun」，其餘（權限不足、PATH 上那個 bun 不是執行檔）照實說。一律自己印，
  // 不讓例外往上跑——這支的全部工作就是把啟動失敗講成人話，丟出 stack trace 等於沒做。
  child.on('error', (error) => {
    const { code, message } = /** @type {NodeJS.ErrnoException} */ (error)
    console.error(code === 'ENOENT' ? MISSING_BUN : `issue-map could not start Bun: ${message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    // 被訊號收掉時沒有離開碼，用 shell 的慣例 128+n 補。否則會退化成 0，`&&` 串接會把中斷
    // 當成成功。
    if (signal) {
      const signum = constants.signals[signal]
      process.exit(typeof signum === 'number' ? 128 + signum : 1)
    }
    process.exit(code ?? 1)
  })
}
