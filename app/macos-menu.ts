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

import { dlopen, type Pointer } from 'bun:ffi'

type NativeObject = Pointer | bigint

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

export function installMacMenu(): void {
  const objc = '/usr/lib/libobjc.A.dylib'
  // objc_msgSend 要照每個方法的實際簽章宣告，參數個數不同就各開一份。
  const base = dlopen(objc, {
    objc_getClass: { args: ['cstring'], returns: 'ptr' },
    sel_registerName: { args: ['cstring'], returns: 'ptr' },
    objc_msgSend: { args: ['ptr', 'ptr'], returns: 'ptr' },
  })
  const withOne = dlopen(objc, { objc_msgSend: { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' } })
  const withThree = dlopen(objc, {
    objc_msgSend: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'ptr' },
  })
  try {
    const cstring = (value: string) => Buffer.from(`${value}\0`)
    const must = (value: NativeObject | null, what: string): NativeObject => {
      if (!value) throw new Error(`Could not build the macOS menu (${what})`)
      return value
    }
    const sel = (name: string) => must(base.symbols.sel_registerName(cstring(name)), name)
    const cls = (name: string) => must(base.symbols.objc_getClass(cstring(name)), name)
    const send = (target: NativeObject, name: string) =>
      must(base.symbols.objc_msgSend(target, sel(name)), name)
    const sendWith = (target: NativeObject, name: string, arg: NativeObject) =>
      withOne.symbols.objc_msgSend(target, sel(name), arg)
    const nsString = (value: string) =>
      must(
        withOne.symbols.objc_msgSend(cls('NSString'), sel('stringWithUTF8String:'), cstring(value)),
        value,
      )
    // `new` 回來的物件由我們持有；掛進選單之後 AppKit 會 retain，這裡就放掉自己那一份。
    const release = (target: NativeObject) => base.symbols.objc_msgSend(target, sel('release'))

    const submenu = (title: string, items: readonly Item[]): NativeObject => {
      const menu = must(
        withOne.symbols.objc_msgSend(
          send(cls('NSMenu'), 'alloc'),
          sel('initWithTitle:'),
          nsString(title),
        ),
        title,
      )
      for (const [label, action, key] of items) {
        const item = must(
          withThree.symbols.objc_msgSend(
            send(cls('NSMenuItem'), 'alloc'),
            sel('initWithTitle:action:keyEquivalent:'),
            nsString(label),
            sel(action),
            nsString(key),
          ),
          label,
        )
        sendWith(menu, 'addItem:', item)
        release(item)
      }
      const holder = send(cls('NSMenuItem'), 'new')
      sendWith(holder, 'setSubmenu:', menu)
      release(menu)
      return holder
    }

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
  } finally {
    withThree.close()
    withOne.close()
    base.close()
  }
}
