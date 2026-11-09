/**
 * app 的本機 HTTP server：選 repo 的首頁、每個 repo 一頁地圖。跑在 worker 裡——WebView 的
 * `run()` 會佔住主執行緒，server 放在主執行緒就永遠回不了請求。
 *
 * 只聽 127.0.0.1，並且只接受 Host 正好是自己的請求：這個 server 會用使用者的 gh 登入去讀
 * repo，DNS rebinding 能讓別的網站以為自己就是這個 origin，擋 Host 就是擋這一招。
 */

import { renderFragment, takeSnapshot } from '../src/issue-map.ts'
import { errorPage, mapPage, mapPath, pickerPage } from './pages.ts'
import { parseRepo, RecentRepos } from './repos.ts'

/** 地圖頁要的東西：GitHub 認的 repo 名（大小寫照它的）與地圖片段。測試用假的換掉 gh。 */
export type DrawMap = (repo: string) => Promise<{ repo: string; fragment: string }>

export interface ServerOptions {
  readonly dataDir: string
  /** 0 交給 OS 挑。 */
  readonly port: number
  readonly drawMap?: DrawMap
}

/**
 * 固定 port 是為了 origin 固定：地圖頁把語言與收合記在 localStorage，而 localStorage 跟著
 * origin（含 port）走——每次開 app 都換 port，偏好就每次都不見。被佔了就退回 OS 指派，只是那一次
 * 記不住偏好。
 */
export const PREFERRED_PORT = 47_474

async function drawWithGh(repo: string): Promise<{ repo: string; fragment: string }> {
  const snapshot = await takeSnapshot(repo)
  console.log(`${snapshot.repo}: ${snapshot.issues.length} issues (${snapshot.generatedAt})`)
  return { repo: snapshot.repo, fragment: await renderFragment(snapshot) }
}

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML })
}

export function startServer(options: ServerOptions) {
  const recent = new RecentRepos(options.dataDir)
  const drawMap = options.drawMap ?? drawWithGh
  /** 同一個 repo 同時抵達的請求共用一次抓取；不同 repo 互不相干。 */
  const inFlight = new Map<string, ReturnType<DrawMap>>()

  function drawShared(repo: string): ReturnType<DrawMap> {
    const key = repo.toLowerCase()
    let pending = inFlight.get(key)
    if (!pending) {
      pending = drawMap(repo).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  async function route(url: URL): Promise<Response> {
    if (url.pathname === '/') return html(pickerPage(await recent.list()))

    if (url.pathname === '/open') {
      const input = url.searchParams.get('repo') ?? ''
      const repo = parseRepo(input)
      if (!repo) {
        const message = `"${input.trim()}" is not a repo. Use owner/name, e.g. cli/cli.`
        return html(pickerPage(await recent.list(), { input, message }), 400)
      }
      return new Response(null, { status: 303, headers: { location: mapPath(repo) } })
    }

    const match = /^\/r\/([^/]+\/[^/]+)$/.exec(url.pathname)
    const repo = match?.[1] ? parseRepo(decodeURIComponent(match[1])) : null
    if (!repo) return new Response('Not found', { status: 404 })
    try {
      const drawn = await drawShared(repo)
      // 最近清單只是捷徑：記不進去就說一聲，地圖照樣給。
      await recent.add(drawn.repo).catch((error: unknown) => {
        console.error(`Could not remember ${drawn.repo}: ${(error as Error).message}`)
      })
      return html(mapPage(drawn.repo, drawn.fragment))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${repo}: ${message}`)
      return html(errorPage(repo, message), 502)
    }
  }

  function serve(port: number) {
    return Bun.serve({
      hostname: '127.0.0.1',
      port,
      async fetch(request) {
        if (request.headers.get('host') !== `127.0.0.1:${server.port}`) {
          return new Response('Forbidden host', { status: 403 })
        }
        if (request.method !== 'GET') return new Response(null, { status: 405 })
        return route(new URL(request.url))
      },
    })
  }

  let server: ReturnType<typeof serve>
  try {
    server = serve(options.port)
  } catch (error) {
    if (options.port === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    console.error(`Port ${options.port} is taken; using a random one (language choice won't stick)`)
    server = serve(0)
  }

  return {
    url: `http://127.0.0.1:${server.port}/`,
    stop: () => server.stop(true),
  }
}
