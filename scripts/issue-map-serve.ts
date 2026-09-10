#!/usr/bin/env bun
/**
 * 開發地圖的本機 server：每一次 GET / 都重新向 GitHub 抓快照再渲染，所以瀏覽器重新整理就是
 * 最新狀態。資料抓取與渲染都在 `issue-map.ts`，這支只負責包成完整 HTML 文件並回應。
 *
 * 這是 package.json 的預設 bin，所以在**要看的那個 repo** 裡直接跑就會畫那個 repo：
 *   bunx github:gunter1020/issue-map
 *
 * 起來之後直接開瀏覽器。不要的話設 `ISSUE_MAP_OPEN=0`——`bun --watch` 的開發模式就是這樣關掉
 * 的，否則每存一次檔就多一個分頁。
 *
 * 在這個 repo 裡開發時：
 *   bun run issue-map:serve                       # http://localhost:4747，不自動開
 *   ISSUE_MAP_PORT=5000 bun run issue-map:serve
 */

import { spawnSync } from 'bun'

import { describe, renderFragment, takeSnapshot } from './issue-map.ts'

// `PORT` 是 Claude 桌面 app 的 launch.json 在 autoPort 換 port 時塞進來的。
const PORT = Number(process.env.ISSUE_MAP_PORT ?? process.env.PORT ?? 4747)
const OPEN = process.env.ISSUE_MAP_OPEN !== '0'

/**
 * 開系統預設瀏覽器。**打不開不算失敗**：server 已經起來了，印出網址讓人自己開就好——把它
 * 當錯誤收掉會讓「地圖其實好好地跑著」這件事被一個無關的問題蓋掉。
 */
function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  const result = spawnSync(command, { stdout: 'ignore', stderr: 'pipe' })
  if (!result.success) {
    console.error(
      `打不開瀏覽器（${command[0]}：${result.stderr.toString().trim()}）——自己開上面那個網址`,
    )
  }
}

async function page(): Promise<string> {
  const snapshot = takeSnapshot()
  console.log(describe(snapshot))
  // 樣板是 artifact 用的片段；本機直接看要補上完整文件與 charset。
  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  return `<!doctype html><html lang="zh-Hant"><head>${head}</head><body>${await renderFragment(snapshot)}</body></html>`
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname !== '/') return new Response(null, { status: 404 })
    try {
      return new Response(await page(), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(message)
      return new Response(message, {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  },
})

const url = `http://localhost:${server.port}`
console.log(`開發地圖：${url}（重新整理就重抓 GitHub）`)
if (OPEN) openInBrowser(url)
