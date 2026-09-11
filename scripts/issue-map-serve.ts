#!/usr/bin/env bun
/**
 * 開發地圖的本機 server：每一次 GET / 都重新向 GitHub 抓快照再渲染，所以瀏覽器重新整理就是
 * 最新狀態。資料抓取與渲染都在 `issue-map.ts`，這支只負責包成完整 HTML 文件並回應。
 *
 * 這是 package.json 的預設 bin，所以在**要看的那個 repo** 裡直接跑就會畫那個 repo：
 *   bunx issue-map@latest
 *
 * 起來之後直接開瀏覽器，`ISSUE_MAP_OPEN=0` 可以關掉（`--watch` 的開發模式靠它，否則每存一次
 * 檔就多一個分頁）。
 *
 * 預設不綁固定 port（`port: 0`，交給 OS 挑），所以在好幾個 repo 裡同時跑不會互相撞；實際網址
 * 跟正在畫的目錄一起印在啟動訊息裡。設 `ISSUE_MAP_PORT` 可以固定，那時撞到就直接失敗而不偷
 * 偷換一個——指定了還被換掉，書籤和反向代理都會對不上。
 *
 * 在這個 repo 裡開發時：
 *   bun run issue-map:serve                       # 隨機 port，不自動開
 *   ISSUE_MAP_PORT=4747 bun run issue-map:serve   # 固定網址，--watch 重啟後還是同一個
 */

import { spawnSync } from 'bun'

import { describe, renderDocument, takeSnapshot } from './issue-map.ts'

// `PORT` 是 Claude 桌面 app 的 launch.json 在 autoPort 換 port 時塞進來的。都沒設就是 0：
// 由 OS 指派，`server.port` 才是真的在聽的那個。
const PORT = Number(process.env.ISSUE_MAP_PORT ?? process.env.PORT ?? 0)
const OPEN = process.env.ISSUE_MAP_OPEN !== '0'

/** 開系統預設瀏覽器。**打不開不算失敗**：server 已經起來了，印出網址讓人自己開就好。 */
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
      `Could not open the browser (${command[0]}: ${result.stderr.toString().trim()}) — open the URL above yourself`,
    )
  }
}

async function page(): Promise<string> {
  const snapshot = takeSnapshot()
  console.log(describe(snapshot))
  return renderDocument(snapshot)
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
console.log(`Dev map for ${process.cwd()}`)
console.log(`  ${url} (every refresh re-fetches from GitHub)`)
if (OPEN) openInBrowser(url)
