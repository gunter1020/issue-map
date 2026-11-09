/**
 * 用 macOS 原生的開啟面板選一個資料夾，回傳它的路徑；按取消就是 `null`。
 *
 * 直接跑 NSOpenPanel 的 `runModal`：對話框屬於這個 app，期間 AppKit 自己轉 modal 迴圈，視窗照常
 * 重繪。不用 `osascript`——那會跳出另一個程式的對話框，而且只能同步等它（主執行緒在
 * `webview.run()` 裡，Bun 的事件迴圈不轉，非同步的 spawn 等不到結果），等的時候視窗整個凍住。
 * https://developer.apple.com/documentation/appkit/nsopenpanel
 *
 * 在主執行緒呼叫（WebView 綁定的回呼就是）。
 */

import { cls, jsString, nsString, send, sendBool, sendLong, sendMaybe, sendWith } from './objc.ts'

/** `NSModalResponseOK`。 */
const OK = 1

export function pickFolder(message: string): string | null {
  const panel = send(cls('NSOpenPanel'), 'openPanel')
  sendBool(panel, 'setCanChooseFiles:', false)
  sendBool(panel, 'setCanChooseDirectories:', true)
  sendBool(panel, 'setAllowsMultipleSelection:', false)
  sendBool(panel, 'setCanCreateDirectories:', false)
  sendWith(panel, 'setMessage:', nsString(message))
  sendWith(panel, 'setPrompt:', nsString('Choose'))
  if (sendLong(panel, 'runModal') !== OK) return null
  const url = sendMaybe(panel, 'URL')
  if (!url) return null
  const path = sendMaybe(url, 'path')
  return path ? jsString(path) : null
}
