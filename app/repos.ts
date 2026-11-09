/**
 * app 要畫哪個 repo、本機分支從哪份 clone 讀：記住最近開過的 repo，與每個 repo 對應的本機目錄。
 *
 * CLI 靠 cwd 讓 gh 推斷 repo、讀 cwd 的分支；app 是雙擊開的，沒有 cwd，所以兩樣都由這裡給。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { parseRepo, remotesAt } from '../src/issue-map-git.ts'

/**
 * 資料目錄裡的一個 JSON 檔。兩份記錄都只是捷徑不是資料：檔案壞掉或格式不對就當成空的重來，
 * 為了它讓 app 開不起來划不來。
 *
 * 一次只寫一筆：兩個地圖頁同時畫完時，並行的讀改寫會共用同一個暫存檔，後到的那個換名時檔案已經
 * 被前一個搬走；就算錯開了，先讀的那份也會蓋掉另一筆。
 */
class JsonFile<T> {
  readonly #file: string
  readonly #parse: (value: unknown) => T
  readonly #empty: T
  #writing: Promise<void> = Promise.resolve()

  constructor(file: string, parse: (value: unknown) => T, empty: T) {
    this.#file = file
    this.#parse = parse
    this.#empty = empty
  }

  async read(): Promise<T> {
    let text: string
    try {
      text = await readFile(this.#file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.#empty
      throw error
    }
    try {
      return this.#parse(JSON.parse(text))
    } catch (error) {
      console.error(`Ignoring unreadable ${this.#file}: ${(error as Error).message}`)
      return this.#empty
    }
  }

  update(change: (current: T) => T): Promise<void> {
    const write = this.#writing.then(async () => {
      const next = change(await this.read())
      await mkdir(join(this.#file, '..'), { recursive: true })
      // 先寫暫存檔再換名：寫到一半被關掉也不會留下半個 JSON。
      const temp = `${this.#file}.tmp`
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
      await rename(temp, this.#file)
    })
    this.#writing = write.catch(() => {})
    return write
  }
}

/** 清單留幾個。再多就是捲動，不是「最近」。 */
const KEEP = 12

/** 最近開過的 repo，新的在前，存在 `recent.json`。只在**畫成功**之後才記，打錯字的不留。 */
export class RecentRepos {
  readonly #store: JsonFile<string[]>

  constructor(dataDir: string) {
    this.#store = new JsonFile(
      join(dataDir, 'recent.json'),
      (value) => {
        if (!Array.isArray(value)) throw new Error('not an array')
        return value.filter((item): item is string => typeof item === 'string' && !!parseRepo(item))
      },
      [],
    )
  }

  list(): Promise<string[]> {
    return this.#store.read()
  }

  add(repo: string): Promise<void> {
    return this.#store.update((list) =>
      [repo, ...list.filter((item) => item !== repo)].slice(0, KEEP),
    )
  }
}

type CloneMap = Readonly<Record<string, string>>

/**
 * 每個 repo 的本機 clone 目錄，存在 `clones.json`，鍵是小寫的 `owner/name`。
 *
 * 只收驗過的目錄：是 git 工作目錄，而且有一個 remote 指向這個 repo。畫圖時還會再對一次——目錄
 * 可能之後被搬走或換了 remote。
 */
export class LocalClones {
  readonly #store: JsonFile<CloneMap>

  constructor(dataDir: string) {
    this.#store = new JsonFile<CloneMap>(
      join(dataDir, 'clones.json'),
      (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('not an object')
        }
        return Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && isAbsolute(entry[1]),
          ),
        )
      },
      {},
    )
  }

  async all(): Promise<CloneMap> {
    return this.#store.read()
  }

  async of(repo: string): Promise<string | undefined> {
    return (await this.#store.read())[repo.toLowerCase()]
  }

  /**
   * 驗過才記。回傳的是記下來的絕對路徑；驗不過就丟出給人看的原因。
   * `~` 開頭的展開成家目錄——從終端機複製來的路徑常常長這樣。
   */
  async set(repo: string, input: string): Promise<string> {
    const trimmed = input.trim()
    const expanded =
      trimmed === '~' || trimmed.startsWith('~/') ? homedir() + trimmed.slice(1) : trimmed
    if (!isAbsolute(expanded))
      throw new Error(`Use a full path for the local clone, e.g. ~/code/${repo.split('/')[1]}`)
    const dir = resolve(expanded)
    const remotes = await remotesAt(dir)
    if (remotes === null) throw new Error(`${dir} is not a git working directory.`)
    if (!remotes.includes(repo.toLowerCase())) {
      throw new Error(`${dir} has no remote pointing at ${repo}.`)
    }
    await this.#store.update((map) => ({ ...map, [repo.toLowerCase()]: dir }))
    return dir
  }
}
