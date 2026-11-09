/**
 * app 的本機 HTTP server：選 repo 的首頁、每個 repo 一頁地圖。跑在 worker 裡——WebView 的
 * `run()` 會佔住主執行緒，server 放在主執行緒就永遠回不了請求。
 *
 * 只聽 loopback、只認自己的 Host，與 CLI server 同一套規則，見 `src/issue-map-loopback.ts`。
 */

import { renderFragment, takeSnapshot } from '../src/issue-map.ts'
import { parseRepo } from '../src/issue-map-git.ts'
import { isOwnHost, LOOPBACK } from '../src/issue-map-loopback.ts'
import { errorPage, mapPage, mapPath, pickerPage, type PickerInput } from './pages.ts'
import { LocalClones, RecentRepos, repoOfClone } from './repos.ts'

/**
 * 地圖頁要的東西：GitHub 認的 repo 名（大小寫照它的）與地圖片段。`gitDir` 是這個 repo 記下來的
 * 本機 clone，沒有就不畫分支。測試用假的換掉 gh。
 */
export type DrawMap = (
  repo: string,
  gitDir: string | undefined,
) => Promise<{ repo: string; fragment: string }>

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

const drawWithGh: DrawMap = async (repo, gitDir) => {
  const snapshot = await takeSnapshot(gitDir === undefined ? { repo } : { repo, gitDir })
  console.log(`${snapshot.repo}: ${snapshot.issues.length} issues (${snapshot.generatedAt})`)
  return { repo: snapshot.repo, fragment: await renderFragment(snapshot) }
}

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML })
}

export function startServer(options: ServerOptions) {
  const recent = new RecentRepos(options.dataDir)
  const clones = new LocalClones(options.dataDir)
  const drawMap = options.drawMap ?? drawWithGh
  /** 同一個 repo 同時抵達的請求共用一次抓取；不同 repo 互不相干。 */
  const inFlight = new Map<string, ReturnType<DrawMap>>()

  async function drawShared(repo: string): ReturnType<DrawMap> {
    const key = repo.toLowerCase()
    let pending = inFlight.get(key)
    if (!pending) {
      pending = clones
        .of(repo)
        .then((gitDir) => drawMap(repo, gitDir))
        .finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  async function picker(problem?: PickerInput, status = 200): Promise<Response> {
    const [list, dirs] = await Promise.all([recent.list(), clones.all()])
    const entries = list.map((repo) => ({ repo, clone: dirs[repo.toLowerCase()] }))
    return html(pickerPage(entries, problem), status)
  }

  /**
   * 要畫哪個 repo：有填就照填的（認不出來是 `null`）；沒填但給了本機目錄，就從它的 remote 推。
   * 推不出來丟出給人看的原因。
   */
  async function repoFor(input: string, path: string): Promise<string | null> {
    if (input.trim() || !path.trim()) return parseRepo(input)
    return repoOfClone(path)
  }

  async function route(url: URL): Promise<Response> {
    if (url.pathname === '/') return picker()

    if (url.pathname === '/open') {
      const input = url.searchParams.get('repo') ?? ''
      const path = url.searchParams.get('path') ?? ''
      let repo: string | null
      try {
        repo = await repoFor(input, path)
      } catch (error) {
        return picker({ input, path, message: (error as Error).message }, 400)
      }
      if (!repo) {
        const message = input.trim()
          ? `"${input.trim()}" is not a repo. Use owner/name, e.g. cli/cli.`
          : 'Enter a repo, or choose its local clone.'
        return picker({ input, path, message }, 400)
      }
      // 本機目錄是選填的；留空就沿用之前記下的那個。
      if (path.trim()) {
        try {
          await clones.set(repo, path)
        } catch (error) {
          return picker({ input, path, message: (error as Error).message }, 400)
        }
      }
      return new Response(null, { status: 303, headers: { location: mapPath(repo) } })
    }

    // 選完資料夾，頁面拿它先把 repo 欄填上，送出前就看得到要畫的是哪一個。
    if (url.pathname === '/clone-repo') {
      const found = await repoOfClone(url.searchParams.get('path') ?? '').then(
        (repo) => ({ repo }),
        (error: unknown) => ({ repo: null, message: (error as Error).message }),
      )
      return Response.json(found, { headers: { 'cache-control': 'no-store' } })
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
      hostname: LOOPBACK,
      port,
      async fetch(request) {
        if (!isOwnHost(request.headers.get('host'), server.port)) {
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
    url: `http://${LOOPBACK}:${server.port}/`,
    stop: () => server.stop(true),
  }
}
