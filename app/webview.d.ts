// `webview.js` 對外的形狀：只列 app 用到的，對照 webview-bun 2.4 的 src/webview.ts。

/**
 * 視窗尺寸的意思。上游是 `const enum`，執行時沒有匯出可拿，所以直接寫值：
 * 0 預設大小、1 最小、2 最大、3 固定不能拖。
 */
type SizeHint = 0 | 1 | 2 | 3

export declare class Webview {
  constructor(debug?: boolean, size?: { width: number; height: number; hint: SizeHint })
  title: string
  /** 每次載入頁面時、在頁面自己的 script 之前跑。 */
  init(source: string): void
  /** 在頁面上掛一個全域函式，呼叫時在主執行緒跑 `callback`。 */
  bind(name: string, callback: (...args: string[]) => unknown): void
  navigate(url: string): void
  run(): void
}
