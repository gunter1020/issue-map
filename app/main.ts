#!/usr/bin/env bun
/**
 * issue-map 桌面 app：worker 裡起本機 server，主執行緒開系統 WebView 看它。
 *
 * 跟 CLI 共用同一套抓取與渲染（`src/issue-map.ts`），差在 repo 從哪來——CLI 讀 cwd，app 在視窗
 * 裡選，見 `repos.ts`。
 *
 *   bun run app                 # 從原始碼開視窗
 *   bun run app --headless      # 只起 server、印網址，給沒有視窗的驗證用
 *   bun run app:build           # 編成 dist/app/issue-map.app
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'

import { openInBrowser } from '../src/issue-map-open.ts'
import { PREFERRED_PORT, type ServerOptions } from './server.ts'

const USAGE = `issue-map app
  --data-dir <path>   Where the recent-repo list lives (default ~/.config/issue-map)
  --port <n>          Server port (default ${PREFERRED_PORT}; falls back to a random one if taken)
  --headless          Start the server and print its URL; no window
  --debug             Enable the WebView developer tools`

/** 頁面上呼叫的全域函式名；主執行緒那一側在 `bind` 時掛上。 */
const OPEN_EXTERNAL = '__issueMapOpenExternal'

/**
 * 地圖上的 GitHub 連結是 `target="_blank"`，WebView 沒有分頁可開，點了不會有任何反應；就算換成
 * 原地開，離開本機頁面之後也沒有上一頁可按。所以別的 origin 的連結一律交給系統瀏覽器。
 *
 * 掛在 window 的冒泡階段、而且先看 `defaultPrevented`：地圖頁自己會攔「點站看詳細」，
 * 那種點擊不是要開 GitHub。
 */
const EXTERNAL_LINKS = `addEventListener('click', (event) => {
  if (event.defaultPrevented || !(event.target instanceof Element)) return
  const link = event.target.closest('a[href]')
  if (!link) return
  const url = new URL(link.href, location.href)
  if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return
  event.preventDefault()
  ${OPEN_EXTERNAL}(url.href)
})`

type WorkerMessage = { type: 'ready'; url: string } | { type: 'error'; message: string }

/**
 * 從 Finder／Dock 開的 app 只拿到 launchd 的 PATH（/usr/bin:/bin:/usr/sbin:/sbin），Homebrew 裝的
 * `gh` 不在裡面。找不到 `gh` 時才去問一次使用者的登入 shell——從終端機開的時候 PATH 本來就對，
 * 不必多付開一個 shell 的時間。問不到就維持原樣，畫圖時 gh 找不到的錯誤會原話顯示在頁面上。
 */
function adoptLoginShellPath(): void {
  if (process.platform === 'win32' || Bun.which('gh')) return
  const marker = '__ISSUE_MAP_PATH__'
  try {
    const result = Bun.spawnSync(
      [process.env.SHELL || '/bin/zsh', '-ilc', `printf '${marker}%s${marker}' "$PATH"`],
      { stdout: 'pipe', stderr: 'ignore', timeout: 5000 },
    )
    const path = result.stdout.toString().split(marker)[1]
    if (result.success && path) process.env.PATH = path
  } catch (error) {
    console.error(`Could not read PATH from the login shell: ${(error as Error).message}`)
  }
}

async function startWorker(options: ServerOptions) {
  // 編譯時 worker 是另一個 entrypoint（見 `app/build.ts`），用相對於這支的路徑找它。
  const worker = new Worker(new URL('./server.worker.ts', import.meta.url), { workerData: options })
  try {
    const url = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Server worker did not start in 10s')), 10_000)
      worker.once('error', (error) => {
        clearTimeout(timer)
        fail(error)
      })
      worker.once('message', (message: WorkerMessage) => {
        clearTimeout(timer)
        if (message.type === 'ready') done(message.url)
        else fail(new Error(message.message))
      })
    })
    return {
      url,
      stop: () => worker.terminate(),
    }
  } catch (error) {
    await worker.terminate()
    throw error
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'data-dir': { type: 'string' },
      port: { type: 'string' },
      headless: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  const port = values.port === undefined ? PREFERRED_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error('--port must be 0–65535')

  adoptLoginShellPath()
  const worker = await startWorker({
    dataDir: resolve(values['data-dir'] ?? join(homedir(), '.config/issue-map')),
    port,
  })

  if (values.headless) {
    console.log(`issue-map app (headless): ${worker.url}`)
    const stop = () => void worker.stop().finally(() => process.exit(0))
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }

  try {
    const { Webview } = await import('./webview.js')
    // hint 0：這只是開窗時的大小，使用者可以拖。
    const webview = new Webview(values.debug, { width: 1280, height: 860, hint: 0 })
    if (process.platform === 'darwin') {
      const { installMacMenu } = await import('./macos-menu.ts')
      installMacMenu()
    }
    webview.title = 'issue-map'
    webview.bind(OPEN_EXTERNAL, (url) => {
      // 頁面送來的字串要自己再驗一次：只放行 http(s)，別的 scheme 交給 `open` 會叫起任意 app。
      if (/^https?:\/\//.test(url)) openInBrowser(url)
    })
    webview.init(EXTERNAL_LINKS)
    webview.navigate(worker.url)
    // 一直卡在這裡直到視窗關掉。
    webview.run()
  } finally {
    await worker.stop()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
