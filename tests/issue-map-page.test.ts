import { describe, expect, test } from 'bun:test'

import { DEFAULT_LOCALE, setLocale, t } from '../src/issue-map-i18n.ts'
import {
  type CopyButton,
  handleCopy,
  hasFoldedAncestor,
  readStored,
  writeStored,
} from '../src/issue-map-page.ts'

/**
 * 瀏覽器端共用的互動邏輯：多層收合祖先鏈、複製鈕的連點還原、以及 localStorage 被擋時的降級。
 */

setLocale(DEFAULT_LOCALE)

function fakeCopyButton(
  command: string,
  text: string,
): {
  button: CopyButton
  label: { textContent: string | null }
  dataset: Record<string, string | undefined>
} {
  const label = { textContent: text as string | null }
  const dataset: Record<string, string | undefined> = { copy: command }
  const button: CopyButton = {
    dataset,
    querySelector: () => label,
  }
  return { button, label, dataset }
}

describe('收合祖先鏈', () => {
  const parents = new Map<number, number | null>([
    [1, null],
    [2, 1],
    [3, 2],
  ])

  test('最上層收合時，第三層也算被收起來', () => {
    const folded = new Set([1])
    expect(
      hasFoldedAncestor(
        2,
        (n) => folded.has(n),
        (n) => parents.get(n) ?? null,
      ),
    ).toBe(true)
    expect(
      hasFoldedAncestor(
        3,
        (n) => folded.has(n),
        (n) => parents.get(n) ?? null,
      ),
    ).toBe(true)
  })

  test('parent 成環時會止血', () => {
    const cycle = new Map<number, number>([
      [1, 2],
      [2, 1],
    ])
    expect(
      hasFoldedAncestor(
        1,
        () => false,
        (n) => cycle.get(n) ?? null,
      ),
    ).toBe(false)
  })
})

describe('複製按鈕', () => {
  test('連點兩次不會把按鈕文字卡在「已複製」', async () => {
    const { button, label, dataset } = fakeCopyButton('/implement #1', '/implement')

    await handleCopy(button, async () => {})
    expect(label.textContent).toBe(t('copy.done'))
    expect(dataset.copied).toBe('true')

    // 回饋文字還沒退掉前再按一次，不該把「Copied」當成原本的指令記下來。
    await handleCopy(button, async () => {})
    await Bun.sleep(1300)

    expect(label.textContent).toBe('/implement')
    expect(dataset.copied).toBeUndefined()
  })

  test('複製失敗顯示失敗字樣，之後還原原本指令', async () => {
    const { button, label, dataset } = fakeCopyButton('/implement #2', '/implement')

    await handleCopy(button, async () => {
      throw new Error('denied')
    })
    expect(label.textContent).toBe(t('copy.fail'))
    expect(dataset.copied).toBeUndefined()

    await Bun.sleep(1700)
    expect(label.textContent).toBe('/implement')
  })
})

describe('偏好儲存降級', () => {
  test('storage 丟例外時讀回 null、寫入不拋錯', () => {
    const broken = {
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('SecurityError')
      },
    }
    expect(readStored('k', broken)).toBeNull()
    expect(() => writeStored('k', 'v', broken)).not.toThrow()
  })
})
