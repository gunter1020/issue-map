#!/usr/bin/env bun
/**
 * 開發地圖的本機 server：每一次 GET / 都重新向 GitHub 抓快照再渲染，所以瀏覽器重新整理就是
 * 最新狀態。資料抓取與渲染都在 `issue-map.ts`，這支只負責包成完整 HTML 文件並回應。
 *
 * 這是 package.json 的預設 bin，所以在**要看的那個 repo** 裡直接跑就會畫那個 repo：
 *   bunx issue-map@latest
 *
 * 起來之後只印網址，不動瀏覽器；要開分頁就明講 `--open`：
 *   bunx issue-map@latest --open
 *
 * 預設不綁固定 port（`port: 0`，交給 OS 挑），所以在好幾個 repo 裡同時跑不會互相撞；實際網址
 * 跟正在畫的目錄一起印在啟動訊息裡。設 `ISSUE_MAP_PORT` 可以固定，那時撞到就直接失敗而不偷
 * 偷換一個——指定了還被換掉，書籤和反向代理都會對不上。
 *
 * 在這個 repo 裡開發時：
 *   bun run issue-map:serve                       # 隨機 port
 *   ISSUE_MAP_PORT=4747 bun run issue-map:serve   # 固定網址，--watch 重啟後還是同一個
 */

import { spawnSync } from 'bun'

import { describe, renderDocument, takeSnapshot } from './issue-map.ts'

// `PORT` 是 Claude 桌面 app 的 launch.json 在 autoPort 換 port 時塞進來的。都沒設就是 0：
// 由 OS 指派，`server.port` 才是真的在聽的那個。
const PORT = Number(process.env.ISSUE_MAP_PORT ?? process.env.PORT ?? 0)

// 開瀏覽器要明講 `--open`。預設不開：`--watch`、CI、遠端 session 都是每重啟一次就多一個分頁，
// 而網址本來就印在啟動訊息裡。打錯的旗標直接失敗，不然「沒開分頁」看不出是預設還是打錯。
const args = process.argv.slice(2)
const unknownArgs = args.filter((arg) => arg !== '--open')
if (unknownArgs.length > 0) {
  console.error(`Unknown argument: ${unknownArgs.join(' ')}`)
  console.error('Usage: issue-map [--open]')
  process.exit(2)
}
const OPEN = args.includes('--open')

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

/**
 * 同時抵達的請求共用同一次抓取。
 *
 * 一次重新整理按兩下、或開著兩個分頁，本來會各自跑一趟完整的 GitHub 抓取；它們要的是同一刻的
 * 狀態，讓後到的等前一趟就好。抓完就清掉，所以「每次重新整理都是最新的」沒有變。
 */
let inFlight: Promise<string> | null = null

async function page(): Promise<string> {
  const snapshot = await takeSnapshot()
  console.log(describe(snapshot))
  return renderDocument(snapshot)
}

function pageShared(): Promise<string> {
  inFlight ??= page().finally(() => {
    inFlight = null
  })
  return inFlight
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname !== '/') return new Response(null, { status: 404 })
    try {
      return new Response(await pageShared(), {
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
