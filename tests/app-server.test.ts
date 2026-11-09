import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RecentRepos } from '../app/repos.ts'
import { startServer, type DrawMap } from '../app/server.ts'
import { makeClone } from './git-fixture.ts'

/**
 * app 的本機 server。地圖本身由 `src/issue-map.ts` 渲染、另有測試，這裡換成假的 `drawMap`，
 * 只看 app 多出來的那層：路由、Host 閘門、同 repo 共用抓取、成功才記進最近清單。
 */

const stops: (() => unknown)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

async function start(drawMap: DrawMap) {
  const dataDir = await mkdtemp(join(tmpdir(), 'issue-map-server-'))
  const server = startServer({ dataDir, port: 0, drawMap })
  stops.push(server.stop)
  return { ...server, recent: new RecentRepos(dataDir) }
}

const fakeMap: DrawMap = async (repo) => ({ repo, fragment: `<p id="map">${repo}</p>` })

describe('路由', () => {
  test('首頁是選 repo 的表單', async () => {
    const { url } = await start(fakeMap)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('action="/open"')
    // 選資料夾要靠視窗掛的原生函式；伺服器送出的頁面預設不顯示按鈕，沒有那個函式就一直藏著。
    expect(body).toContain('id="pick-folder" hidden')
  })

  /** 表單送來的是網址也好、owner/name 也好，都導到同一個地圖頁。 */
  test('/open 收斂輸入後導到地圖頁', async () => {
    const { url } = await start(fakeMap)
    const response = await fetch(`${url}open?repo=https://github.com/a/b/issues`, {
      redirect: 'manual',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/r/a/b')
  })

  /** 認不出來的留在首頁說清楚，原本打的字保留在欄位裡讓人改。 */
  test('/open 認不出來就留在首頁並標出錯誤', async () => {
    const { url } = await start(fakeMap)
    const response = await fetch(`${url}open?repo=nope`)
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).toContain('role="alert"')
    expect(body).toContain('value="nope"')
  })

  test('地圖頁有工具列與地圖本體', async () => {
    const { url } = await start(fakeMap)
    const body = await (await fetch(`${url}r/a/b`)).text()
    expect(body).toContain('class="app-bar"')
    expect(body).toContain('<p id="map">a/b</p>')
  })

  test('不是 repo 的路徑就 404', async () => {
    const { url } = await start(fakeMap)
    expect((await fetch(`${url}r/a`)).status).toBe(404)
    expect((await fetch(`${url}favicon.ico`)).status).toBe(404)
  })
})

describe('Host 閘門', () => {
  /** DNS rebinding 會帶著別的 Host 打進來；擋掉它，別的網站就拿不到用使用者 gh 登入抓的東西。 */
  test('Host 不是自己就 403', async () => {
    const { url } = await start(fakeMap)
    const { port } = new URL(url)
    // fetch 不讓改 Host，改用 raw socket 送一個請求。
    const response = await new Promise<string>((resolve, reject) => {
      let text = ''
      Bun.connect({
        hostname: '127.0.0.1',
        port: Number(port),
        socket: {
          open(socket) {
            socket.write('GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n')
          },
          data(_socket, chunk) {
            text += chunk.toString()
          },
          close() {
            resolve(text)
          },
          error(_socket, error) {
            reject(error)
          },
        },
      }).catch(reject)
    })
    expect(response).toStartWith('HTTP/1.1 403')
  })
})

describe('抓取與最近清單', () => {
  /** 同一個 repo 同時兩個請求只抓一次；那是同一刻的狀態，各抓一趟只是浪費 API 額度。 */
  test('同一個 repo 同時抵達的請求共用一次抓取', async () => {
    let calls = 0
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { url } = await start(async (repo) => {
      calls += 1
      await gate
      return fakeMap(repo, undefined)
    })
    const both = Promise.all([fetch(`${url}r/a/b`), fetch(`${url}r/A/B`)])
    await Bun.sleep(20)
    release()
    const statuses = (await both).map((response) => response.status)
    expect(statuses).toEqual([200, 200])
    expect(calls).toBe(1)
  })

  /** 記 GitHub 認的名字（大小寫照它的），打錯字的不記。 */
  test('畫成功才記，記的是 GitHub 回的名字', async () => {
    const { url, recent } = await start(async (repo) => {
      if (repo === 'a/missing') throw new Error('Repository not found')
      return { repo: 'Owner/Repo', fragment: '' }
    })
    const failed = await fetch(`${url}r/a/missing`)
    expect(failed.status).toBe(502)
    expect(await failed.text()).toContain('Repository not found')
    expect(await recent.list()).toEqual([])

    await fetch(`${url}r/owner/repo`)
    expect(await recent.list()).toEqual(['Owner/Repo'])
  })
})

describe('本機 clone', () => {
  /** 記下 drawMap 每次拿到的目錄，看伺服器有沒有把對的 clone 交出去。 */
  function recording() {
    const seen: (string | undefined)[] = []
    const drawMap: DrawMap = async (repo, gitDir) => {
      seen.push(gitDir)
      return { repo, fragment: '' }
    }
    return { seen, drawMap }
  }

  const open = (url: string, repo: string, path: string) =>
    fetch(`${url}open?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`, {
      redirect: 'manual',
    })

  /** 隨便一個目錄都收的話，分支圖會畫出別的 repo 的分支。 */
  test('不是 git 目錄、或 remote 不是這個 repo，就留在首頁說原因', async () => {
    const { url } = await start(recording().drawMap)
    const plain = await mkdtemp(join(tmpdir(), 'issue-map-plain-'))
    const notGit = await open(url, 'owner/repo', plain)
    expect(notGit.status).toBe(400)
    expect(await notGit.text()).toContain('is not a git working directory')

    const other = await open(url, 'someone/else', await makeClone())
    expect(other.status).toBe(400)
    expect(await other.text()).toContain('has no remote pointing at someone/else')
  })

  test('驗過的目錄記下來，之後畫這個 repo 都帶著它；留空沿用', async () => {
    const { seen, drawMap } = recording()
    const { url } = await start(drawMap)
    const clone = await makeClone()
    expect((await open(url, 'Owner/Repo', clone)).status).toBe(303)
    await fetch(`${url}r/owner/repo`)
    expect((await open(url, 'owner/repo', '')).status).toBe(303)
    await fetch(`${url}r/owner/repo`)
    expect(seen).toEqual([clone, clone])

    const home = await (await fetch(url)).text()
    expect(home).toContain(clone)
  })

  /** 只選了資料夾：repo 從它的 remote 推，不必再手打一次。 */
  test('repo 留空、給了 clone，就照 clone 的 remote 開', async () => {
    const { seen, drawMap } = recording()
    const { url } = await start(drawMap)
    const clone = await makeClone('git@github.com:Owner/Repo.git')
    const response = await open(url, '', clone)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/r/Owner/Repo')
    await fetch(`${url}r/owner/repo`)
    expect(seen).toEqual([clone])
  })

  test('repo 與 clone 都沒給就留在首頁說要填什麼', async () => {
    const { url } = await start(recording().drawMap)
    const response = await open(url, '', '')
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Enter a repo, or choose its local clone.')
  })

  /** 頁面選完資料夾用它填 repo 欄；認不出來時回原因，不回錯誤碼——那不是頁面壞了。 */
  test('/clone-repo 回這份 clone 的 repo，認不出來就是 null 加原因', async () => {
    const { url } = await start(recording().drawMap)
    const ask = async (path: string) =>
      (await fetch(`${url}clone-repo?path=${encodeURIComponent(path)}`)).json()
    expect(await ask(await makeClone())).toEqual({ repo: 'owner/repo' })
    const plain = await mkdtemp(join(tmpdir(), 'issue-map-plain-'))
    expect(await ask(plain)).toEqual({
      repo: null,
      message: `${plain} is not a git working directory.`,
    })
  })

  test('相對路徑不收', async () => {
    const { url } = await start(recording().drawMap)
    const response = await open(url, 'owner/repo', 'code/repo')
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Use a full path')
  })
})
