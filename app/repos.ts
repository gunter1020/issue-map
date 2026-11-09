/**
 * app 要畫哪個 repo：把使用者輸入的字收斂成 `owner/name`，並記住最近開過的那幾個。
 *
 * CLI 靠 cwd 讓 gh 推斷 repo；app 是雙擊開的，沒有 cwd 可推，所以 repo 一律由這裡交給 gh 的
 * `GH_REPO`。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** GitHub 的帳號名：英數與連字號，不能以連字號開頭，最長 39。 */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
/** repo 名：英數、`.`、`_`、`-`，但 `.` 與 `..` 是路徑而不是名字。 */
const NAME = /^[A-Za-z0-9._-]{1,100}$/

/**
 * 接受 `owner/name` 或從瀏覽器貼來的 GitHub 網址（含 `/issues` 這類後綴、`.git` 結尾）。
 * 認不出來就回 `null`，讓畫面說清楚是哪裡不對，而不是把怪字串交給 gh。
 */
export function parseRepo(input: string): string | null {
  const path = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
  const [owner, rawName] = path.split('/')
  const name = rawName?.replace(/\.git$/i, '')
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name)) return null
  if (name === '.' || name === '..') return null
  return `${owner}/${name}`
}

/** 清單留幾個。再多就是捲動，不是「最近」。 */
const KEEP = 12

/**
 * 最近開過的 repo，新的在前，存在資料目錄的 `recent.json`。
 *
 * 只在**畫成功**之後才記：打錯字的 repo 不該留在清單上。檔案壞掉或格式不對就當成空清單重來——
 * 它只是捷徑，不是資料，為了它讓 app 開不起來划不來。
 */
export class RecentRepos {
  readonly #file: string

  constructor(dataDir: string) {
    this.#file = join(dataDir, 'recent.json')
  }

  async list(): Promise<string[]> {
    let text: string
    try {
      text = await readFile(this.#file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      return parsed.filter((item): item is string => typeof item === 'string' && !!parseRepo(item))
    } catch (error) {
      console.error(`Ignoring unreadable ${this.#file}: ${(error as Error).message}`)
      return []
    }
  }

  /**
   * 一次只寫一筆：兩個地圖頁同時畫完時，並行的讀改寫會共用同一個暫存檔，後到的那個換名時檔案
   * 已經被前一個搬走；就算錯開了，先讀的那份也會蓋掉另一筆。
   */
  add(repo: string): Promise<void> {
    const write = this.#writing.then(() => this.#write(repo))
    this.#writing = write.catch(() => {})
    return write
  }

  #writing: Promise<void> = Promise.resolve()

  async #write(repo: string): Promise<void> {
    const next = [repo, ...(await this.list()).filter((item) => item !== repo)].slice(0, KEEP)
    await mkdir(join(this.#file, '..'), { recursive: true })
    // 先寫暫存檔再換名：寫到一半被關掉也不會留下半個 JSON。
    const temp = `${this.#file}.tmp`
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
    await rename(temp, this.#file)
  }
}
