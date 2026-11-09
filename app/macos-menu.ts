/**
 * macOS 選單列。webview-bun 不建選單，少了它 ⌘C、⌘V、⌘Q 都沒有反應——而地圖上的指令
 * （`/implement #12`）本來就是要複製出去貼的。
 *
 * 每個項目的 target 都是 nil，AppKit 會沿著 responder chain 交給聚焦中的 WebView（剪貼簿、
 * `reload:`）或 NSApplication（`terminate:`）處理，所以這裡不必拿到任何視窗的指標。
 * https://developer.apple.com/documentation/appkit/nsmenuitem
 *
 * 要在 Webview 建好（NSApplication 已存在）之後、`run()` 之前，在主執行緒呼叫。
 */

import { cls, type Id, nsString, release, sel, send, sendWith, sendWith3 } from './objc.ts'

type Item = readonly [title: string, action: string, key: string]

const APP_ITEMS: readonly Item[] = [['Quit issue-map', 'terminate:', 'q']]
const EDIT_ITEMS: readonly Item[] = [
  ['Cut', 'cut:', 'x'],
  ['Copy', 'copy:', 'c'],
  ['Paste', 'paste:', 'v'],
  ['Select All', 'selectAll:', 'a'],
]
const VIEW_ITEMS: readonly Item[] = [['Reload', 'reload:', 'r']]
const WINDOW_ITEMS: readonly Item[] = [
  ['Minimize', 'performMiniaturize:', 'm'],
  ['Close', 'performClose:', 'w'],
]

function submenu(title: string, items: readonly Item[]): Id {
  const menu = sendWith(send(cls('NSMenu'), 'alloc'), 'initWithTitle:', nsString(title))
  if (!menu) throw new Error(`Could not build the ${title} menu`)
  for (const [label, action, key] of items) {
    const item = sendWith3(
      send(cls('NSMenuItem'), 'alloc'),
      'initWithTitle:action:keyEquivalent:',
      nsString(label),
      sel(action),
      nsString(key),
    )
    sendWith(menu, 'addItem:', item)
    release(item)
  }
  const holder = send(cls('NSMenuItem'), 'new')
  sendWith(holder, 'setSubmenu:', menu)
  release(menu)
  return holder
}

export function installMacMenu(): void {
  const app = send(cls('NSApplication'), 'sharedApplication')
  const bar = send(cls('NSMenu'), 'new')
  // 第一個項目一律被 AppKit 當成應用程式選單（標題換成 app 名），所以 Quit 放這裡。
  for (const [title, items] of [
    ['issue-map', APP_ITEMS],
    ['Edit', EDIT_ITEMS],
    ['View', VIEW_ITEMS],
    ['Window', WINDOW_ITEMS],
  ] as const) {
    const holder = submenu(title, items)
    sendWith(bar, 'addItem:', holder)
    release(holder)
  }
  sendWith(app, 'setMainMenu:', bar)
  release(bar)
}
